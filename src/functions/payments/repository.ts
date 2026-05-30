import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Payment, PaymentRecord, CreatePaymentInput, UpdatePaymentInput, ListPaymentsParams } from './types';
import * as clientRepo from '../clients/repository';
import { getCurrentTimestampInTimezone } from '../shared/timezone-utils';

const TABLE = process.env.TABLE_PAYMENTS as string;
const CLIENT_TABLE = process.env.TABLE_CLIENTS as string;
const CREDIT_NOTES_TABLE = process.env.TABLE_CREDIT_NOTES as string;
const METRICS_TABLE = process.env.TABLE_METRICS as string;

console.log('Payments Repository initialized. TABLE_PAYMENTS:', TABLE);

if (!TABLE) {
  console.error('ERROR: TABLE_PAYMENTS environment variable is not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields (PK, SK, GSI fields, numberLower) before returning to callers.
 */
function toPayment(record: Record<string, unknown>): Payment {
  const { PK: _pk, SK: _sk, clientIdGSI: _cg, creditNoteIdGSI: _cng, statusGSI: _sg, methodGSI: _mg, numberLower: _nl, ...rest } = record as unknown as PaymentRecord;
  return rest as Payment;
}

/**
 * Get a counter for generating sequential payment numbers
 */
async function getNextPaymentNumber(orgId: string): Promise<number> {
  const counterKey = { PK: `org#${orgId}`, SK: 'counter#payments' };

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: counterKey,
        UpdateExpression: 'ADD #counter :inc',
        ExpressionAttributeNames: { '#counter': 'counter' },
        ExpressionAttributeValues: { ':inc': 1 },
        ReturnValues: 'ALL_NEW',
      }),
    );
    return (result.Attributes?.counter as number) || 1;
  } catch (e) {
    // If the counter doesn't exist, create it
    await ddb.send(
      new PutCommand({
        TableName: TABLE,
        Item: {
          PK: `org#${orgId}`,
          SK: 'counter#payments',
          counter: 1,
        },
      }),
    );
    return 1;
  }
}

export async function getPaymentById(orgId: string, paymentId: string): Promise<Payment | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `org#${orgId}`, SK: `payment#${paymentId}` },
    }),
  );
  return result.Item ? toPayment(result.Item) : null;
}

export async function listPayments(params: ListPaymentsParams): Promise<{ items: Payment[]; total: number }> {
  const pk = `org#${params.orgId}`;

  const keyCondition = 'PK = :pk AND begins_with(SK, :skPrefix)';
  const exprValues: Record<string, unknown> = { ':pk': pk, ':skPrefix': 'payment#' };
  const exprNames: Record<string, string> = {};
  const filterParts: string[] = [];

  if (params.status) {
    filterParts.push('#status = :status');
    exprNames['#status'] = 'status';
    exprValues[':status'] = params.status;
  }

  if (params.method) {
    filterParts.push('#method = :method');
    exprNames['#method'] = 'method';
    exprValues[':method'] = params.method;
  }

  if (params.clientId) {
    filterParts.push('clientId = :clientId');
    exprValues[':clientId'] = params.clientId;
  }

  if (params.creditNoteId) {
    filterParts.push('creditNoteId = :creditNoteId');
    exprValues[':creditNoteId'] = params.creditNoteId;
  }

  if (params.search) {
    filterParts.push('(contains(numberLower, :search) OR contains(clientName, :search) OR contains(invoiceNumber, :search))');
    exprValues[':search'] = params.search.toLowerCase();
  }

  const queryInput = {
    TableName: TABLE,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: exprValues,
    ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
    ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
  };

  // Query all pages for this org's payments, then sort/paginate in-memory.
  const allItems: Payment[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
    for (const item of result.Items ?? []) {
      allItems.push(toPayment(item));
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // In-memory sort
  const field = params.sortBy as keyof Payment;
  allItems.sort((a, b) => {
    const aVal = a[field];
    const bVal = b[field];
    let cmp: number;

    if (typeof aVal === 'string' && typeof bVal === 'string') {
      cmp = aVal.localeCompare(bVal);
    } else if (typeof aVal === 'number' && typeof bVal === 'number') {
      cmp = aVal - bVal;
    } else {
      cmp = String(aVal ?? '').localeCompare(String(bVal ?? ''));
    }

    return params.sortOrder === 'asc' ? cmp : -cmp;
  });

  const total = allItems.length;
  const start = (params.page - 1) * params.limit;
  return { items: allItems.slice(start, start + params.limit), total };
}

export async function createPayment(orgId: string, input: CreatePaymentInput): Promise<Payment> {
  const now = getCurrentTimestampInTimezone();
  const paymentId = crypto.randomUUID();

  // Resolve client and ensure payment does not exceed current debt.
  const client = await clientRepo.getClientById(orgId, input.clientId);
  if (!client) {
    throw new Error(`Client not found in organization: ${input.clientId}`);
  }

  if (input.amount > client.accumulatedDebt) {
    throw new Error(
      `Payment amount ${input.amount} cannot exceed client accumulated debt ${client.accumulatedDebt}`,
    );
  }

  // Resolve credit note and validate remaining balance
  const creditNoteResult = await ddb.send(
    new GetCommand({
      TableName: CREDIT_NOTES_TABLE,
      Key: { PK: `org#${orgId}`, SK: `creditnote#${input.creditNoteId}` },
    }),
  );

  if (!creditNoteResult.Item) {
    throw new Error(`Credit note not found: ${input.creditNoteId}`);
  }

  const creditNote = creditNoteResult.Item;
  const currentPaid = (creditNote.paid as number) || 0;
  const remaining = (creditNote.amount as number) - currentPaid;

  if (input.amount > remaining) {
    throw new Error(
      `Payment amount ${input.amount} exceeds credit note remaining balance ${remaining}`,
    );
  }

  const newPaid = currentPaid + input.amount;
  const newStatus = newPaid >= (creditNote.amount as number) ? 'paid' : 'partial';

  // Generate or use provided number
  let paymentNumber = input.number;
  if (!paymentNumber) {
    const counter = await getNextPaymentNumber(orgId);
    paymentNumber = `AB-${String(counter).padStart(3, '0')}`;
  }

  // Calculate the accumulated debt AFTER this payment is processed
  const clientAccumulatedDebtAfterPayment = client.accumulatedDebt - input.amount;

  const record: PaymentRecord = {
    PK: `org#${orgId}`,
    SK: `payment#${paymentId}`,
    id: paymentId,
    orgId,
    number: paymentNumber,
    numberLower: paymentNumber.toLowerCase(),
    creditNoteId: input.creditNoteId,
    creditNoteIdGSI: input.creditNoteId,
    clientId: input.clientId,
    clientIdGSI: input.clientId,
    clientName: client.name,
    invoiceNumber: creditNote.invoiceNumber as string,
    amount: input.amount,
    method: input.method,
    methodGSI: input.method,
    status: input.status || 'pending',
    statusGSI: input.status || 'pending',
    bankName: input.bankName,
    reference: input.reference,
    description: input.description,
    clientAccumulatedDebtAtRecord: clientAccumulatedDebtAfterPayment,
    clientCreditLimitAtRecord: client.creditLimit - clientAccumulatedDebtAfterPayment,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: record,
            ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)',
          },
        },
        {
          Update: {
            TableName: CLIENT_TABLE,
            Key: { PK: `org#${orgId}`, SK: `client#${input.clientId}` },
            UpdateExpression:
              'SET #accumulatedDebt = if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) - :amount, #lastPayment = :lastPayment, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#accumulatedDebt': 'accumulatedDebt',
              '#legacyBalance': 'balance',
              '#lastPayment': 'lastPayment',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':amount': input.amount,
              ':zero': 0,
              ':lastPayment': now,
              ':updatedAt': now,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
        {
          Update: {
            TableName: CREDIT_NOTES_TABLE,
            Key: { PK: `org#${orgId}`, SK: `creditnote#${input.creditNoteId}` },
            UpdateExpression:
              'SET #paid = :newPaid, #status = :newStatus, #statusGSI = :newStatus, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#paid': 'paid',
              '#status': 'status',
              '#statusGSI': 'statusGSI',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':newPaid': newPaid,
              ':newStatus': newStatus,
              ':updatedAt': now,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    }),
  );

  // Update monthly payments metrics asynchronously
  updateMonthlyPaymentsMetrics(orgId).catch(err =>
    console.warn('Failed to update monthly payments metrics:', err),
  );

  return toPayment(record as unknown as Record<string, unknown>);
}

export async function updatePayment(orgId: string, paymentId: string, input: UpdatePaymentInput): Promise<Payment | null> {
  const key = { PK: `org#${orgId}`, SK: `payment#${paymentId}` };

  // Get existing record to determine clientId for debt lookup
  const existing = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: key,
    }),
  );

  if (!existing.Item) return null;

  const clientId = input.clientId || (existing.Item.clientId as string);
  const client = await clientRepo.getClientById(orgId, clientId);
  if (!client) {
    throw new Error('Client not found in organization');
  }

  const sets: string[] = ['#updatedAt = :updatedAt', '#clientAccumulatedDebtAtRecord = :clientAccumulatedDebtAtRecord', '#clientCreditLimitAtRecord = :clientCreditLimitAtRecord'];
  const removes: string[] = [];
  const values: Record<string, unknown> = { 
    ':updatedAt': getCurrentTimestampInTimezone(),
    ':clientAccumulatedDebtAtRecord': client.accumulatedDebt,
    ':clientCreditLimitAtRecord': client.creditLimit - client.accumulatedDebt,
  };
  const names: Record<string, string> = { '#updatedAt': 'updatedAt', '#clientAccumulatedDebtAtRecord': 'clientAccumulatedDebtAtRecord', '#clientCreditLimitAtRecord': 'clientCreditLimitAtRecord' };

  if (input.number !== undefined) {
    sets.push('#number = :number', '#numberLower = :numberLower');
    names['#number'] = 'number';
    names['#numberLower'] = 'numberLower';
    values[':number'] = input.number;
    values[':numberLower'] = input.number.toLowerCase();
  }

  if (input.clientId !== undefined) {
    // Resolve new client name
    let clientName = input.clientId;
    try {
      const clientData = await clientRepo.getClientById(orgId, input.clientId);
      if (!clientData) {
        throw new Error(`Client not found: ${input.clientId}`);
      }
      clientName = clientData.name;
    } catch (e) {
      throw new Error(`Client not found in organization: ${input.clientId}`);
    }

    sets.push('#clientId = :clientId', '#clientIdGSI = :clientIdGSI', '#clientName = :clientName');
    names['#clientId'] = 'clientId';
    names['#clientIdGSI'] = 'clientIdGSI';
    names['#clientName'] = 'clientName';
    values[':clientId'] = input.clientId;
    values[':clientIdGSI'] = input.clientId;
    values[':clientName'] = clientName;
  }

  if (input.invoiceNumber !== undefined) {
    sets.push('#invoiceNumber = :invoiceNumber');
    names['#invoiceNumber'] = 'invoiceNumber';
    values[':invoiceNumber'] = input.invoiceNumber;
  }

  if (input.amount !== undefined) {
    sets.push('#amount = :amount');
    names['#amount'] = 'amount';
    values[':amount'] = input.amount;
  }

  if (input.method !== undefined) {
    sets.push('#method = :method', '#methodGSI = :methodGSI');
    names['#method'] = 'method';
    names['#methodGSI'] = 'methodGSI';
    values[':method'] = input.method;
    values[':methodGSI'] = input.method;
  }

  if (input.status !== undefined) {
    sets.push('#status = :status', '#statusGSI = :statusGSI');
    names['#status'] = 'status';
    names['#statusGSI'] = 'statusGSI';
    values[':status'] = input.status;
    values[':statusGSI'] = input.status;
  }

  if (input.bankName !== undefined) {
    if (input.bankName) {
      sets.push('#bankName = :bankName');
      names['#bankName'] = 'bankName';
      values[':bankName'] = input.bankName;
    } else {
      removes.push('#bankName');
      names['#bankName'] = 'bankName';
    }
  }

  if (input.reference !== undefined) {
    if (input.reference) {
      sets.push('#reference = :reference');
      names['#reference'] = 'reference';
      values[':reference'] = input.reference;
    } else {
      removes.push('#reference');
      names['#reference'] = 'reference';
    }
  }

  if (input.description !== undefined) {
    if (input.description) {
      sets.push('#description = :description');
      names['#description'] = 'description';
      values[':description'] = input.description;
    } else {
      removes.push('#description');
      names['#description'] = 'description';
    }
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) updateExpression += ` REMOVE ${removes.join(', ')}`;

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    
    // Update monthly payments metrics if status or amount changed
    if (input.status !== undefined || input.amount !== undefined) {
      updateMonthlyPaymentsMetrics(orgId).catch(err =>
        console.warn('Failed to update monthly payments metrics:', err),
      );
    }
    
    return toPayment(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deletePayment(orgId: string, paymentId: string): Promise<boolean> {
  const key = { PK: `org#${orgId}`, SK: `payment#${paymentId}` };

  try {
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: key,
      }),
    );

    if (!existing.Item) return false;

    const clientId = existing.Item.clientId as string | undefined;
    const creditNoteId = existing.Item.creditNoteId as string | undefined;
    const amount = Number(existing.Item.amount ?? 0);
    const now = getCurrentTimestampInTimezone();

    let creditNoteUpdate:
      | {
          Update: {
            TableName: string;
            Key: { PK: string; SK: string };
            UpdateExpression: string;
            ExpressionAttributeNames: Record<string, string>;
            ExpressionAttributeValues: Record<string, unknown>;
            ConditionExpression: string;
          };
        }
      | undefined;

    if (creditNoteId) {
      const creditNoteResult = await ddb.send(
        new GetCommand({
          TableName: CREDIT_NOTES_TABLE,
          Key: { PK: `org#${orgId}`, SK: `creditnote#${creditNoteId}` },
        }),
      );

      if (creditNoteResult.Item) {
        const creditNoteAmount = Number(creditNoteResult.Item.amount ?? 0);
        const currentPaid = Number(creditNoteResult.Item.paid ?? 0);
        const newPaid = Math.max(0, currentPaid - amount);
        const newStatus = newPaid <= 0 ? 'pending' : newPaid >= creditNoteAmount ? 'paid' : 'partial';

        creditNoteUpdate = {
          Update: {
            TableName: CREDIT_NOTES_TABLE,
            Key: { PK: `org#${orgId}`, SK: `creditnote#${creditNoteId}` },
            UpdateExpression:
              'SET #paid = :newPaid, #status = :newStatus, #statusGSI = :newStatus, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#paid': 'paid',
              '#status': 'status',
              '#statusGSI': 'statusGSI',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':newPaid': newPaid,
              ':newStatus': newStatus,
              ':updatedAt': now,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        };
      }
    }

    const transactItems: Array<any> = [
      {
        Delete: {
          TableName: TABLE,
          Key: key,
          ConditionExpression: 'attribute_exists(PK)',
        },
      },
    ];

    if (clientId) {
      transactItems.push({
        Update: {
          TableName: CLIENT_TABLE,
          Key: { PK: `org#${orgId}`, SK: `client#${clientId}` },
          UpdateExpression:
            'SET #accumulatedDebt = if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) + :amount, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#accumulatedDebt': 'accumulatedDebt',
            '#legacyBalance': 'balance',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':amount': amount,
            ':zero': 0,
            ':updatedAt': now,
          },
          ConditionExpression: 'attribute_exists(PK)',
        },
      });
    }

    if (creditNoteUpdate) {
      transactItems.push(creditNoteUpdate);
    }

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      }),
    );

    // Update monthly payments metrics asynchronously
    updateMonthlyPaymentsMetrics(orgId).catch(err =>
      console.warn('Failed to update monthly payments metrics:', err),
    );

    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/**
 * Update the monthly payments total metrics for an organization
 * Queries all payments for the given month and updates the metrics table
 */
export async function updateMonthlyPaymentsMetrics(orgId: string, date: Date = new Date()): Promise<void> {
  try {
    // Format date as YYYY-MM for the SK
    const yearMonth = date.toISOString().slice(0, 7); // e.g., "2026-05"
    
    // Query all payments for this org
    const pk = `org#${orgId}`;
    const queryInput = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'payment#',
      },
    };

    const allPayments: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    // Fetch all payments for this organization
    do {
      const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
      for (const item of result.Items ?? []) {
        allPayments.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Filter and sum all payments from the same month (regardless of status)
    let totalAmount = 0;
    for (const payment of allPayments) {
      const createdAt = payment.createdAt as string;
      const paymentMonth = createdAt.slice(0, 7); // Extract YYYY-MM from ISO date

      if (paymentMonth === yearMonth) {
        totalAmount += Number(payment.amount ?? 0);
      }
    }

    // Update metrics table with the total
    if (METRICS_TABLE) {
      const metricsKey = {
        PK: `PaymentsTotalMonth#${orgId}`,
        SK: yearMonth,
      };

      await ddb.send(
        new UpdateCommand({
          TableName: METRICS_TABLE,
          Key: metricsKey,
          UpdateExpression: 'SET #value = :value, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#value': 'value',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':value': totalAmount,
            ':updatedAt': getCurrentTimestampInTimezone(),
          },
        }),
      );
    }
  } catch (error) {
    console.error('Error updating monthly payments metrics:', error);
    // Don't throw - this is a non-critical operation
  }
}
