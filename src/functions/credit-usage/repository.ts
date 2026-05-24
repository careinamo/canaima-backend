import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { CreditUsageRecord, CreditUsageInput } from './types';

const TABLE_CLIENTS = process.env.TABLE_CLIENTS as string;
const TABLE_METRICS = process.env.TABLE_METRICS as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Get all active clients for an organization with only creditLimit and accumulatedDebt
 */
export async function getActiveClientsForOrg(orgId: string): Promise<
  Array<{
    creditLimit: number;
    accumulatedDebt: number;
  }>
> {
  const pk = `org#${orgId}`;

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_CLIENTS,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'client#',
      },
      ProjectionExpression: 'creditLimit, accumulatedDebt, #status',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
    }),
  );

  // Filter only active clients
  const activeClients = (result.Items ?? []).filter((item: any) => item.status === 'active');

  return activeClients.map((item: any) => ({
    creditLimit: item.creditLimit || 0,
    accumulatedDebt: item.accumulatedDebt || 0,
  }));
}

/**
 * Calculate credit usage percentage for an organization
 * Formula: (Total Accumulated Debt / Total Credit Limit) * 100
 */
export async function calculateCreditUsage(orgId: string): Promise<{
  percentage: number;
  totalAccumulatedDebt: number;
  totalCreditLimit: number;
  activeClientsCount: number;
}> {
  const clients = await getActiveClientsForOrg(orgId);

  if (clients.length === 0) {
    return {
      percentage: 0,
      totalAccumulatedDebt: 0,
      totalCreditLimit: 0,
      activeClientsCount: 0,
    };
  }

  const totalAccumulatedDebt = clients.reduce((sum, c) => sum + (c.accumulatedDebt || 0), 0);
  const totalCreditLimit = clients.reduce((sum, c) => sum + (c.creditLimit || 0), 0);

  // Avoid division by zero
  const percentage =
    totalCreditLimit > 0 ? parseFloat(((totalAccumulatedDebt / totalCreditLimit) * 100).toFixed(2)) : 0;

  return {
    percentage,
    totalAccumulatedDebt,
    totalCreditLimit,
    activeClientsCount: clients.length,
  };
}

/**
 * Save credit usage record to DynamoDB
 */
export async function saveCreditUsageRecord(
  orgId: string,
  usage: {
    percentage: number;
    totalAccumulatedDebt: number;
    totalCreditLimit: number;
    activeClientsCount: number;
  },
): Promise<CreditUsageRecord> {
  const now = new Date().toISOString();
  const dateStr = new Date(now).toISOString().split('T')[0]; // YYYY-MM-DD

  const record: CreditUsageRecord = {
    PK: `CreditUsed#${orgId}`,
    SK: dateStr,
    orgId,
    value: usage.percentage,
    totalAccumulatedDebt: usage.totalAccumulatedDebt,
    totalCreditLimit: usage.totalCreditLimit,
    activeClientsCount: usage.activeClientsCount,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE_METRICS,
      Item: record,
    }),
  );

  return record;
}

/**
 * Get the latest credit usage record for an organization
 */
export async function getLatestCreditUsage(orgId: string): Promise<CreditUsageRecord | null> {
  const pk = `CreditUsed#${orgId}`;

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE_METRICS,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
      ScanIndexForward: false, // Descending order
      Limit: 1,
    }),
  );

  return result.Items && result.Items.length > 0 ? (result.Items[0] as CreditUsageRecord) : null;
}
