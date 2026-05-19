import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Payment, PaymentRecord, CreatePaymentInput, UpdatePaymentInput, ListPaymentsParams } from './types';
import * as clientRepo from '../clients/repository';

const TABLE = process.env.TABLE_PAYMENTS as string;
const CLIENT_TABLE = process.env.TABLE_CLIENTS as string;

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
  const { PK: _pk, SK: _sk, clientIdGSI: _cg, statusGSI: _sg, methodGSI: _mg, numberLower: _nl, ...rest } = record as unknown as PaymentRecord;
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
  const now = new Date().toISOString();
  const paymentId = crypto.randomUUID();

  // Resolve client name
  let clientName = input.clientId;
  try {
    const client = await clientRepo.getClientById(orgId, input.clientId);
    if (!client) {
      throw new Error(`Client not found: ${input.clientId}`);
    }
    clientName = client.name;
  } catch (e) {
    throw new Error(`Client not found in organization: ${input.clientId}`);
  }

  // Generate or use provided number
  let paymentNumber = input.number;
  if (!paymentNumber) {
    const counter = await getNextPaymentNumber(orgId);
    paymentNumber = `AB-${String(counter).padStart(3, '0')}`;
  }

  const record: PaymentRecord = {
    PK: `org#${orgId}`,
    SK: `payment#${paymentId}`,
    id: paymentId,
    orgId,
    number: paymentNumber,
    numberLower: paymentNumber.toLowerCase(),
    clientId: input.clientId,
    clientIdGSI: input.clientId,
    clientName,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    method: input.method,
    methodGSI: input.method,
    status: input.status || 'pending',
    statusGSI: input.status || 'pending',
    bankName: input.bankName,
    reference: input.reference,
    description: input.description,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: record }));
  return toPayment(record as unknown as Record<string, unknown>);
}

export async function updatePayment(orgId: string, paymentId: string, input: UpdatePaymentInput): Promise<Payment | null> {
  const key = { PK: `org#${orgId}`, SK: `payment#${paymentId}` };

  const sets: string[] = ['#updatedAt = :updatedAt'];
  const removes: string[] = [];
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };

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
      const client = await clientRepo.getClientById(orgId, input.clientId);
      if (!client) {
        throw new Error(`Client not found: ${input.clientId}`);
      }
      clientName = client.name;
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
    return toPayment(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deletePayment(orgId: string, paymentId: string): Promise<boolean> {
  const key = { PK: `org#${orgId}`, SK: `payment#${paymentId}` };

  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: key,
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}
