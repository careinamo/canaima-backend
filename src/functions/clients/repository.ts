import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  ScanCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Client, ClientRecord, CreateClientInput, UpdateClientInput, ListClientsParams } from './types';

const TABLE = process.env.TABLE_CLIENTS as string;
const EMAIL_INDEX = 'emailIndex';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields (nameLower, emailLower) before returning to callers.
 */
function toClient(record: Record<string, unknown>): Client {
  const { nameLower: _nl, emailLower: _el, ...rest } = record as unknown as ClientRecord;
  return rest as Client;
}

export async function findClientByEmail(email: string): Promise<Client | null> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: EMAIL_INDEX,
      KeyConditionExpression: 'emailLower = :email',
      ExpressionAttributeValues: { ':email': email.toLowerCase() },
      Limit: 1,
    }),
  );
  const item = result.Items?.[0];
  return item ? toClient(item) : null;
}

export async function getClientById(id: string): Promise<Client | null> {
  const result = await ddb.send(new GetCommand({ TableName: TABLE, Key: { id } }));
  return result.Item ? toClient(result.Item) : null;
}

export async function listClients(
  params: ListClientsParams,
): Promise<{ items: Client[]; total: number }> {
  const filterParts: string[] = [];
  const exprValues: Record<string, unknown> = {};
  const exprNames: Record<string, string> = {};

  if (params.status) {
    filterParts.push('#status = :status');
    exprNames['#status'] = 'status';
    exprValues[':status'] = params.status;
  }

  if (params.search) {
    filterParts.push('(contains(nameLower, :search) OR contains(emailLower, :search))');
    exprValues[':search'] = params.search.toLowerCase();
  }

  const scanInput = {
    TableName: TABLE,
    ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
    ...(Object.keys(exprValues).length > 0 && { ExpressionAttributeValues: exprValues }),
    ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
  };

  // Paginate through all DynamoDB pages to get the full matching set, then slice in-memory.
  // Acceptable for a B2B clients dataset (typically hundreds to low thousands of records).
  const allItems: Client[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new ScanCommand({ ...scanInput, ExclusiveStartKey: lastKey }));
    for (const item of result.Items ?? []) {
      allItems.push(toClient(item));
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // In-memory sort
  const field = params.sortBy as keyof Client;
  allItems.sort((a, b) => {
    const cmp = String(a[field] ?? '').localeCompare(String(b[field] ?? ''));
    return params.sortOrder === 'asc' ? cmp : -cmp;
  });

  const total = allItems.length;
  const start = (params.page - 1) * params.limit;
  return { items: allItems.slice(start, start + params.limit), total };
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const now = new Date().toISOString();
  const record: ClientRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    nameLower: input.name.toLowerCase(),
    email: input.email,
    emailLower: input.email.toLowerCase(),
    phone: input.phone,
    address: input.address,
    status: input.status,
    creditLimit: input.creditLimit,
    balance: 0,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: record }));
  return toClient(record as unknown as Record<string, unknown>);
}

export async function updateClient(id: string, input: UpdateClientInput): Promise<Client | null> {
  // Prefix all field names with # to avoid DynamoDB reserved word conflicts
  const sets: string[] = ['#updatedAt = :updatedAt'];
  const removes: string[] = [];
  const values: Record<string, unknown> = { ':updatedAt': new Date().toISOString() };
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };

  if (input.name !== undefined) {
    sets.push('#name = :name', '#nameLower = :nameLower');
    names['#name'] = 'name';
    names['#nameLower'] = 'nameLower';
    values[':name'] = input.name;
    values[':nameLower'] = input.name.toLowerCase();
  }
  if (input.email !== undefined) {
    sets.push('#email = :email', '#emailLower = :emailLower');
    names['#email'] = 'email';
    names['#emailLower'] = 'emailLower';
    values[':email'] = input.email;
    values[':emailLower'] = input.email.toLowerCase();
  }
  if (input.status !== undefined) {
    sets.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = input.status;
  }
  if (input.creditLimit !== undefined) {
    sets.push('#creditLimit = :creditLimit');
    names['#creditLimit'] = 'creditLimit';
    values[':creditLimit'] = input.creditLimit;
  }

  // Optional nullable fields — if present but undefined → REMOVE, if present with value → SET
  for (const field of ['phone', 'address', 'notes'] as const) {
    if (field in input) {
      if (input[field] !== undefined) {
        sets.push(`#${field} = :${field}`);
        names[`#${field}`] = field;
        values[`:${field}`] = input[field];
      } else {
        removes.push(`#${field}`);
        names[`#${field}`] = field;
      }
    }
  }

  let updateExpression = `SET ${sets.join(', ')}`;
  if (removes.length > 0) updateExpression += ` REMOVE ${removes.join(', ')}`;

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { id },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
        ConditionExpression: 'attribute_exists(id)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toClient(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deleteClient(id: string): Promise<boolean> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { id },
        ConditionExpression: 'attribute_exists(id)',
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}
