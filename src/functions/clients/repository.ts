import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Client, ClientRecord, CreateClientInput, UpdateClientInput, ListClientsParams } from './types';
import { getCurrentTimestampInTimezone } from '../shared/timezone-utils';

const TABLE = process.env.TABLE_CLIENTS as string;
const EMAIL_INDEX = 'emailIndex';

console.log('Repository initialized. TABLE_CLIENTS:', TABLE);

if (!TABLE) {
  console.error('ERROR: TABLE_CLIENTS environment variable is not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields (PK, SK, nameLower, emailLower) before returning to callers.
 */
function toClient(record: Record<string, unknown>): Client {
  const {
    PK: _pk,
    SK: _sk,
    nameLower: _nl,
    emailLower: _el,
    balance,
    accumulatedDebt,
    ...rest
  } = record as unknown as ClientRecord & { balance?: number; accumulatedDebt?: number };

  return {
    ...rest,
    accumulatedDebt:
      typeof accumulatedDebt === 'number'
        ? accumulatedDebt
        : typeof balance === 'number'
          ? balance
          : 0,
  } as Client;
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

export async function getClientById(orgId: string, clientId: string): Promise<Client | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: `org#${orgId}`, SK: `client#${clientId}` },
    }),
  );
  return result.Item ? toClient(result.Item) : null;
}

export async function listClients(
  params: ListClientsParams,
): Promise<{ items: Client[]; total: number }> {
  const pk = `org#${params.orgId}`;

  const keyCondition = 'PK = :pk AND begins_with(SK, :skPrefix)';
  const exprValues: Record<string, unknown> = { ':pk': pk, ':skPrefix': 'client#' };
  const exprNames: Record<string, string> = {};
  const filterParts: string[] = [];

  if (params.active !== undefined) {
    filterParts.push('#active = :active');
    exprNames['#active'] = 'active';
    exprValues[':active'] = params.active;
  }

  if (params.delinquent !== undefined) {
    filterParts.push('#delinquent = :delinquent');
    exprNames['#delinquent'] = 'delinquent';
    exprValues[':delinquent'] = params.delinquent;
  }

  if (params.search) {
    filterParts.push('(contains(nameLower, :search) OR contains(emailLower, :search))');
    exprValues[':search'] = params.search.toLowerCase();
  }

  const queryInput = {
    TableName: TABLE,
    KeyConditionExpression: keyCondition,
    ExpressionAttributeValues: exprValues,
    ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
    ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
  };

  // Query all pages for this org's clients, then sort/paginate in-memory.
  const allItems: Client[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
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

export async function createClient(orgId: string, input: CreateClientInput): Promise<Client> {
  const now = getCurrentTimestampInTimezone();
  const clientId = randomUUID();

  const record: ClientRecord = {
    PK: `org#${orgId}`,
    SK: `client#${clientId}`,
    id: clientId,
    orgId,
    name: input.name,
    nameLower: input.name.toLowerCase(),
    email: input.email,
    emailLower: input.email ? input.email.toLowerCase() : undefined,
    phone: input.phone,
    address: input.address,
    active: input.active,
    delinquent: input.delinquent ?? false,
    creditLimit: input.creditLimit,
    accumulatedDebt: input.accumulatedDebt ?? 0,
    notes: input.notes,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(new PutCommand({ TableName: TABLE, Item: record }));
  return toClient(record as unknown as Record<string, unknown>);
}

/**
 * Create multiple clients in batch.
 * Returns array with successful clients and errors.
 */
export async function createClientsBatch(
  orgId: string,
  inputs: CreateClientInput[],
): Promise<{ created: Client[]; errors: Array<{ email: string; error: string }> }> {
  const created: Client[] = [];
  const errors: Array<{ email: string; error: string }> = [];
  const now = getCurrentTimestampInTimezone();

  // Check for duplicate emails across the batch and in DB
  const emailsInBatch = new Set<string>();
  for (const input of inputs) {
    // Only validate email if provided
    if (input.email) {
      if (emailsInBatch.has(input.email)) {
        errors.push({ email: input.email, error: 'Duplicate email in batch' });
        continue;
      }
      emailsInBatch.add(input.email);

      try {
        // Check if email already exists in DB
        const existing = await findClientByEmail(input.email);
        if (existing) {
          errors.push({ email: input.email, error: 'Email already exists' });
          continue;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ email: input.email, error: message });
        continue;
      }
    }

    try {

      const clientId = randomUUID();
      const record: ClientRecord = {
        PK: `org#${orgId}`,
        SK: `client#${clientId}`,
        id: clientId,
        orgId,
        name: input.name,
        nameLower: input.name.toLowerCase(),
        email: input.email,
        emailLower: input.email ? input.email.toLowerCase() : undefined,
        phone: input.phone,
        address: input.address,
        active: input.active,
        delinquent: input.delinquent ?? false,
        creditLimit: input.creditLimit,
        accumulatedDebt: input.accumulatedDebt ?? 0,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      };

      await ddb.send(new PutCommand({ TableName: TABLE, Item: record }));
      created.push(toClient(record as unknown as Record<string, unknown>));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ email: input.email ?? 'unknown', error: message });
    }
  }

  return { created, errors };
}

export async function updateClient(orgId: string, clientId: string, input: UpdateClientInput): Promise<Client | null> {
  const key = { PK: `org#${orgId}`, SK: `client#${clientId}` };

  const sets: string[] = ['#updatedAt = :updatedAt'];
  const removes: string[] = [];
  const values: Record<string, unknown> = { ':updatedAt': getCurrentTimestampInTimezone() };
  const names: Record<string, string> = { '#updatedAt': 'updatedAt' };

  if (input.name !== undefined) {
    sets.push('#name = :name', '#nameLower = :nameLower');
    names['#name'] = 'name';
    names['#nameLower'] = 'nameLower';
    values[':name'] = input.name;
    values[':nameLower'] = input.name.toLowerCase();
  }
  if (input.email !== undefined) {
    sets.push('#email = :email');
    names['#email'] = 'email';
    if (input.email) {
      sets.push('#emailLower = :emailLower');
      names['#emailLower'] = 'emailLower';
      values[':email'] = input.email;
      values[':emailLower'] = input.email.toLowerCase();
    } else {
      removes.push('#emailLower');
      names['#emailLower'] = 'emailLower';
      values[':email'] = undefined;
    }
  }
  if (input.active !== undefined) {
    sets.push('#active = :active');
    names['#active'] = 'active';
    values[':active'] = input.active;
  }
  if (input.delinquent !== undefined) {
    sets.push('#delinquent = :delinquent');
    names['#delinquent'] = 'delinquent';
    values[':delinquent'] = input.delinquent;
  }
  if (input.creditLimit !== undefined) {
    sets.push('#creditLimit = :creditLimit');
    names['#creditLimit'] = 'creditLimit';
    values[':creditLimit'] = input.creditLimit;
  }

  if (input.accumulatedDebt !== undefined) {
    sets.push('#accumulatedDebt = :accumulatedDebt');
    names['#accumulatedDebt'] = 'accumulatedDebt';
    values[':accumulatedDebt'] = input.accumulatedDebt;
  }

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

  let conditionExpression = 'attribute_exists(PK)';

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: key,
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: values,
        ExpressionAttributeNames: names,
        ConditionExpression: conditionExpression,
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toClient(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function addToAccumulatedDebt(orgId: string, clientId: string, amount: number): Promise<Client | null> {
  const key = { PK: `org#${orgId}`, SK: `client#${clientId}` };

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: key,
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
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(PK)',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toClient(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function subtractFromAccumulatedDebt(
  orgId: string,
  clientId: string,
  amount: number,
): Promise<Client | null> {
  const key = { PK: `org#${orgId}`, SK: `client#${clientId}` };

  try {
    const result = await ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: key,
        UpdateExpression:
          'SET #accumulatedDebt = if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) - :amount, #lastPayment = :lastPayment, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#accumulatedDebt': 'accumulatedDebt',
          '#legacyBalance': 'balance',
          '#lastPayment': 'lastPayment',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':amount': amount,
          ':zero': 0,
          ':lastPayment': new Date().toISOString(),
          ':updatedAt': new Date().toISOString(),
        },
        ConditionExpression:
          'attribute_exists(PK) AND if_not_exists(#accumulatedDebt, if_not_exists(#legacyBalance, :zero)) >= :amount',
        ReturnValues: 'ALL_NEW',
      }),
    );
    return toClient(result.Attributes as Record<string, unknown>);
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return null;
    throw e;
  }
}

export async function deleteClient(orgId: string, clientId: string): Promise<boolean> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: { PK: `org#${orgId}`, SK: `client#${clientId}` },
        ConditionExpression: 'attribute_exists(PK)',
      }),
    );
    return true;
  } catch (e) {
    if ((e as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}
