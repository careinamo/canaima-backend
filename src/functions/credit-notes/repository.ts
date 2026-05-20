import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  TransactWriteCommand,
  UpdateCommand,
  DeleteCommand,
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

  return toCreditNote(record as unknown as Record<string, unknown>);
}

export async function updateCreditNote(
  orgId: string,
  noteId: string,
  input: UpdateCreditNoteInput,
): Promise<CreditNote | null> {
  const key = { PK: `org#${orgId}`, SK: `creditnote#${noteId}` };

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
    return toCreditNote(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deleteCreditNote(orgId: string, noteId: string): Promise<boolean> {
  const key = { PK: `org#${orgId}`, SK: `creditnote#${noteId}` };

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
