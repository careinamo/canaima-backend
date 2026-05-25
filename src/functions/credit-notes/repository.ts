import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { CreditNote, CreditNoteRecord, CreateCreditNoteInput, UpdateCreditNoteInput, ListCreditNotesParams } from './types';
import * as clientRepo from '../clients/repository';

export class CreditLimitExceededError extends Error {
  constructor(
    public creditLimit: number,
    public exceedAmount: number,
  ) {
    super(`Credit limit exceeded by ${exceedAmount}`);
    this.name = 'CreditLimitExceededError';
  }
}

const TABLE = process.env.TABLE_CREDIT_NOTES as string;
const CLIENT_TABLE = process.env.TABLE_CLIENTS as string;
const METRICS_TABLE = process.env.TABLE_METRICS as string;

console.log('Credit Notes Repository initialized. TABLE_CREDIT_NOTES:', TABLE);

if (!TABLE) {
  console.error('ERROR: TABLE_CREDIT_NOTES environment variable is not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields (PK, SK, statusGSI, clientIdGSI, numberLower) before returning to callers.
 */
function toCreditNote(record: Record<string, unknown>): CreditNote {
  const { PK: _pk, SK: _sk, statusGSI: _sg, clientIdGSI: _cg, numberLower: _nl, ...rest } = record as unknown as CreditNoteRecord;
  return rest as CreditNote;
}

/**
 * Get a counter for generating sequential note numbers
 */
async function getNextNoteNumber(orgId: string): Promise<number> {
  const counterKey = { PK: `org#${orgId}`, SK: 'counter#creditnotes' };

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
          SK: 'counter#creditnotes',
          counter: 1,
        },
      }),
    );
    return 1;
  }
}

export async function getCreditNoteById(orgId: string, noteId: string): Promise<CreditNote | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `org#${orgId}`, SK: `creditnote#${noteId}` },
    }),
  );
  return result.Item ? toCreditNote(result.Item) : null;
}

export async function listCreditNotes(
  params: ListCreditNotesParams,
): Promise<{ items: CreditNote[]; total: number }> {
  // If filtering by clientId, use GSI
  if (params.clientId) {
    const exprValues: Record<string, unknown> = {
      ':clientIdGSI': params.clientId,
    };
    const exprNames: Record<string, string> = {
      '#clientIdGSI': 'clientIdGSI',
    };
    const filterParts: string[] = [];
    if (params.status) {
      filterParts.push('#status = :status');
      exprNames['#status'] = 'status';
      exprValues[':status'] = params.status;
    }
    if (params.search) {
      filterParts.push('(contains(numberLower, :search) OR contains(clientName, :search) OR contains(invoiceNumber, :search))');
      exprValues[':search'] = params.search.toLowerCase();
    }
    const queryInput = {
      TableName: TABLE,
      IndexName: 'clientIdIndex',
      KeyConditionExpression: '#clientIdGSI = :clientIdGSI',
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
    };
    // Query all pages for this client's credit notes
    const allItems: CreditNote[] = [];
    let lastKey: Record<string, unknown> | undefined;
    do {
      const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
      for (const item of result.Items ?? []) {
        // Extra check: orgId match (in case GSI is not unique per org)
        if (item.orgId === params.orgId) {
          allItems.push(toCreditNote(item));
        }
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);
    // In-memory sort and pagination
    const field = params.sortBy as keyof CreditNote;
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

  // Default: query all credit notes for org
  const pk = `org#${params.orgId}`;
  const keyCondition = 'PK = :pk AND begins_with(SK, :skPrefix)';
  const exprValues: Record<string, unknown> = { ':pk': pk, ':skPrefix': 'creditnote#' };
  const exprNames: Record<string, string> = {};
  const filterParts: string[] = [];
  if (params.status) {
    filterParts.push('#status = :status');
    exprNames['#status'] = 'status';
    exprValues[':status'] = params.status;
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
  // Query all pages for this org's credit notes, then sort/paginate in-memory.
  const allItems: CreditNote[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
    for (const item of result.Items ?? []) {
      allItems.push(toCreditNote(item));
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);
  // In-memory sort
  const field = params.sortBy as keyof CreditNote;
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

export async function createCreditNote(orgId: string, input: CreateCreditNoteInput): Promise<CreditNote> {
  const client = await clientRepo.getClientById(orgId, input.clientId);
  if (!client) {
    throw new Error('Client not found in organization');
  }

  // Validate that adding this credit note won't exceed credit limit
  const newDebt = client.accumulatedDebt + input.amount;
  if (newDebt > client.creditLimit) {
    const exceedAmount = newDebt - client.creditLimit;
    throw new CreditLimitExceededError(client.creditLimit, exceedAmount);
  }

  const now = new Date().toISOString();
  const noteId = crypto.randomUUID();

  // Generate or use provided number
  let noteNumber = input.number;
  if (!noteNumber) {
    const counter = await getNextNoteNumber(orgId);
    noteNumber = `NC-${String(counter).padStart(3, '0')}`;
  }

  const record: CreditNoteRecord = {
    PK: `org#${orgId}`,
    SK: `creditnote#${noteId}`,
    id: noteId,
    orgId,
    number: noteNumber,
    numberLower: noteNumber.toLowerCase(),
    clientId: input.clientId,
    clientIdGSI: input.clientId,
    clientName: client.name,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    paid: 0,
    status: input.status || 'pending',
    statusGSI: input.status || 'pending',
    dueDate: input.dueDate,
    description: input.description,
    clientAccumulatedDebtAtRecord: newDebt,
    clientCreditLimitAtRecord: client.creditLimit,
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
              'SET #accumulatedDebt = if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) + :amount, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#accumulatedDebt': 'accumulatedDebt',
              '#legacyBalance': 'balance',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':amount': input.amount,
              ':zero': 0,
              ':updatedAt': now,
            },
            ConditionExpression: 'attribute_exists(PK)',
          },
        },
      ],
    }),
  );

  // Update monthly credit notes metrics asynchronously
  updateMonthlyCreditNotesMetrics(orgId).catch(err =>
    console.warn('Failed to update monthly credit notes metrics:', err),
  );

  return toCreditNote(record as unknown as Record<string, unknown>);
}

export async function updateCreditNote(
  orgId: string,
  noteId: string,
  input: UpdateCreditNoteInput,
): Promise<CreditNote | null> {
  const key = { PK: `org#${orgId}`, SK: `creditnote#${noteId}` };

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
    ':updatedAt': new Date().toISOString(),
    ':clientAccumulatedDebtAtRecord': client.accumulatedDebt,
    ':clientCreditLimitAtRecord': client.creditLimit,
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
    sets.push('#clientId = :clientId', '#clientIdGSI = :clientIdGSI');
    names['#clientId'] = 'clientId';
    names['#clientIdGSI'] = 'clientIdGSI';
    values[':clientId'] = input.clientId;
    values[':clientIdGSI'] = input.clientId;
  }

  if (input.clientName !== undefined) {
    sets.push('#clientName = :clientName');
    names['#clientName'] = 'clientName';
    values[':clientName'] = input.clientName;
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

  if (input.status !== undefined) {
    sets.push('#status = :status', '#statusGSI = :statusGSI');
    names['#status'] = 'status';
    names['#statusGSI'] = 'statusGSI';
    values[':status'] = input.status;
    values[':statusGSI'] = input.status;
  }

  if (input.dueDate !== undefined) {
    sets.push('#dueDate = :dueDate');
    names['#dueDate'] = 'dueDate';
    values[':dueDate'] = input.dueDate;
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
    
    // Update monthly credit notes metrics if amount changed
    if (input.amount !== undefined) {
      updateMonthlyCreditNotesMetrics(orgId).catch(err =>
        console.warn('Failed to update monthly credit notes metrics:', err),
      );
    }
    
    return toCreditNote(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deleteCreditNote(orgId: string, noteId: string): Promise<boolean> {
  const key = { PK: `org#${orgId}`, SK: `creditnote#${noteId}` };

  try {
    const existing = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: key,
      }),
    );

    if (!existing.Item) return false;

    const clientId = existing.Item.clientId as string | undefined;
    const amount = Number(existing.Item.amount ?? 0);
    const now = new Date().toISOString();

    const transactItems: Array<Record<string, unknown>> = [];

    transactItems.push({
      Delete: {
        TableName: TABLE,
        Key: key,
        ConditionExpression: 'attribute_exists(PK)',
      },
    });

    if (clientId) {
      transactItems.push({
        Update: {
          TableName: CLIENT_TABLE,
          Key: { PK: `org#${orgId}`, SK: `client#${clientId}` },
          UpdateExpression:
            'SET #accumulatedDebt = if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) - :amount, #updatedAt = :updatedAt',
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

    await ddb.send(
      new TransactWriteCommand({
        TransactItems: transactItems,
      }),
    );

    // Update monthly credit notes metrics asynchronously
    updateMonthlyCreditNotesMetrics(orgId).catch(err =>
      console.warn('Failed to update monthly credit notes metrics:', err),
    );

    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

/**
 * Update the monthly credit notes total metrics for an organization
 * Queries all credit notes for the given month and updates the metrics table
 */
export async function updateMonthlyCreditNotesMetrics(orgId: string, date: Date = new Date()): Promise<void> {
  try {
    // Format date as YYYY-MM for the SK
    const yearMonth = date.toISOString().slice(0, 7); // e.g., "2026-05"
    
    // Query all credit notes for this org
    const pk = `org#${orgId}`;
    const queryInput = {
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'creditnote#',
      },
    };

    const allCreditNotes: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    // Fetch all credit notes for this organization
    do {
      const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
      for (const item of result.Items ?? []) {
        allCreditNotes.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Filter and sum all credit notes from the same month (regardless of status)
    let totalAmount = 0;
    for (const creditNote of allCreditNotes) {
      const createdAt = creditNote.createdAt as string;
      const creditNoteMonth = createdAt.slice(0, 7); // Extract YYYY-MM from ISO date

      if (creditNoteMonth === yearMonth) {
        totalAmount += Number(creditNote.amount ?? 0);
      }
    }

    // Update metrics table with the total
    if (METRICS_TABLE) {
      const metricsKey = {
        PK: `CreditNotesTotalMonth#${orgId}`,
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
            ':updatedAt': new Date().toISOString(),
          },
        }),
      );
    }
  } catch (error) {
    console.error('Error updating monthly credit notes metrics:', error);
    // Don't throw - this is a non-critical operation
  }
}
