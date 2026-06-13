import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import { getCurrentTimestampInTimezone } from './timezone-utils';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const CLIENT_TABLE = process.env.TABLE_CLIENTS as string;
const METRICS_TABLE = process.env.TABLE_METRICS as string;

/**
 * Update the monthly delinquent clients count metric for an organization
 * Queries all clients and counts how many are marked as delinquent
 * Stores the metric with SK as YYYY-MM (monthly) and includes previousMonthValue
 */
export async function updateDelinquentClientsMetrics(orgId: string, date: Date = new Date()): Promise<void> {
  try {
    // Format date as YYYY-MM for monthly SK
    const yearMonth = date.toISOString().slice(0, 7); // e.g., "2026-06"
    console.log(`Updating monthly delinquent clients metrics for org ${orgId}, month ${yearMonth}`);

    // Query all clients for this org
    const pk = `org#${orgId}`;
    const queryInput = {
      TableName: CLIENT_TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'client#',
      },
    };

    const allClients: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    // Fetch all clients for this organization
    do {
      const result = await ddb.send(new QueryCommand({ ...queryInput, ExclusiveStartKey: lastKey }));
      for (const item of result.Items ?? []) {
        allClients.push(item);
      }
      lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (lastKey);

    // Calculate metrics
    let delinquentCount = 0;
    let activeClientsCount = 0;
    let totalAccumulatedDebt = 0;
    let totalCreditLimit = 0;

    for (const client of allClients) {
      const isActive = (client.active as boolean) !== false; // Default to active if not set
      const isDelinquent = (client.delinquent as boolean) === true;

      if (isActive) {
        activeClientsCount++;
      }

      if (isDelinquent) {
        delinquentCount++;
      }

      totalAccumulatedDebt += Number(client.accumulatedDebt ?? 0);
      totalCreditLimit += Number(client.creditLimit ?? 0);
    }

    // Get previous month value
    const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    const previousYearMonth = previousMonth.toISOString().slice(0, 7); // e.g., "2026-05"

    let previousMonthValue: number | null = null;

    try {
      const previousMonthResult = await ddb.send(
        new GetCommand({
          TableName: METRICS_TABLE,
          Key: {
            PK: `DelinquentClientsTotalMonth#${orgId}`,
            SK: previousYearMonth,
          },
        }),
      );

      if (previousMonthResult.Item) {
        previousMonthValue = (previousMonthResult.Item.value as number) ?? null;
      }
    } catch (e) {
      // Previous month record doesn't exist, that's ok
      console.log(`No previous month record found for ${previousYearMonth}`);
    }

    // Update/create the monthly metrics record
    console.log(`Delinquent clients count for ${yearMonth}: ${delinquentCount}, previousMonth: ${previousMonthValue}`);

    const metricsKey = {
      PK: `DelinquentClientsTotalMonth#${orgId}`,
      SK: yearMonth,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: METRICS_TABLE,
        Key: metricsKey,
        UpdateExpression:
          'SET #value = :value, #activeClientsCount = :activeClientsCount, #totalAccumulatedDebt = :totalAccumulatedDebt, #totalCreditLimit = :totalCreditLimit, #previousMonthValue = :previousMonthValue, #createdAt = if_not_exists(#createdAt, :createdAt), #updatedAt = :updatedAt, orgId = :orgId',
        ExpressionAttributeNames: {
          '#value': 'value',
          '#activeClientsCount': 'activeClientsCount',
          '#totalAccumulatedDebt': 'totalAccumulatedDebt',
          '#totalCreditLimit': 'totalCreditLimit',
          '#previousMonthValue': 'previousMonthValue',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':value': delinquentCount,
          ':activeClientsCount': activeClientsCount,
          ':totalAccumulatedDebt': totalAccumulatedDebt,
          ':totalCreditLimit': totalCreditLimit,
          ':previousMonthValue': previousMonthValue,
          ':createdAt': getCurrentTimestampInTimezone(),
          ':updatedAt': getCurrentTimestampInTimezone(),
          ':orgId': orgId,
        },
      }),
    );

    console.log(`Successfully updated monthly delinquent clients metrics for org ${orgId}`);
  } catch (error) {
    console.error('Error updating monthly delinquent clients metrics:', error);
    // Don't throw - this is a non-critical operation
  }
}
