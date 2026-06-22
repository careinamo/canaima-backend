import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { ClientReportRow } from './types';

const TABLE = process.env.TABLE_CLIENTS as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

interface ClientRecord {
  name: string;
  document?: string;
  accumulatedDebt?: number;
  balance?: number; // legacy field
}

/**
 * List all clients for an organization (without pagination)
 * Used for generating reports
 */
export async function listAllClients(orgId: string): Promise<ClientReportRow[]> {
  const pk = `org#${orgId}`;
  const clients: ClientReportRow[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': 'client#',
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      const record = item as ClientRecord;
      clients.push({
        name: record.name,
        document: record.document || '',
        accumulatedDebt:
          typeof record.accumulatedDebt === 'number'
            ? record.accumulatedDebt
            : typeof record.balance === 'number'
              ? record.balance
              : 0,
      });
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // Sort by name
  clients.sort((a, b) => a.name.localeCompare(b.name));

  return clients;
}
