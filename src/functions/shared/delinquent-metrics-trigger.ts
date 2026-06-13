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

console.log('[DelinquentMetrics] Module loaded. CLIENT_TABLE:', CLIENT_TABLE, 'METRICS_TABLE:', METRICS_TABLE);

/**
 * Update the daily delinquent clients count metric for an organization
 * Queries all clients and counts how many are marked as delinquent
 * Stores the metric with SK as YYYY-MM-DD (daily) and includes previousDayValue
 */
export async function updateDelinquentClientsMetrics(orgId: string, date: Date = new Date()): Promise<void> {
  console.log(`[DelinquentMetrics] Function called for org ${orgId}`);
  console.log(`[DelinquentMetrics] METRICS_TABLE value: "${METRICS_TABLE}"`);
  
  if (!METRICS_TABLE) {
    console.error('[DelinquentMetrics] ERROR: METRICS_TABLE is not defined!');
    return;
  }

  try {
    // Format date as YYYY-MM-DD for daily SK
    const dateString = date.toISOString().slice(0, 10); // e.g., "2026-06-13"
    console.log(`Updating daily delinquent clients metrics for org ${orgId}, date ${dateString}`);

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

    // Get previous day value
    const previousDay = new Date(date);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDateString = previousDay.toISOString().slice(0, 10); // e.g., "2026-06-12"

    let previousDayValue: number | null = null;

    try {
      const previousDayResult = await ddb.send(
        new GetCommand({
          TableName: METRICS_TABLE,
          Key: {
            PK: `DelinquentClientsTotal#${orgId}`,
            SK: previousDateString,
          },
        }),
      );

      if (previousDayResult.Item) {
        previousDayValue = (previousDayResult.Item.value as number) ?? null;
      }
    } catch (e) {
      // Previous day record doesn't exist, that's ok
      console.log(`No previous day record found for ${previousDateString}`);
    }

    // Update/create the daily metrics record
    console.log(`[DelinquentMetrics] About to save: delinquentCount=${delinquentCount}, previousDay=${previousDayValue}`);
    console.log(`[DelinquentMetrics] Saving to table: ${METRICS_TABLE}, PK: DelinquentClientsTotal#${orgId}, SK: ${dateString}`);

    const metricsKey = {
      PK: `DelinquentClientsTotal#${orgId}`,
      SK: dateString,
    };

    await ddb.send(
      new UpdateCommand({
        TableName: METRICS_TABLE,
        Key: metricsKey,
        UpdateExpression:
          'SET #value = :value, #activeClientsCount = :activeClientsCount, #totalAccumulatedDebt = :totalAccumulatedDebt, #totalCreditLimit = :totalCreditLimit, #previousDayValue = :previousDayValue, #createdAt = if_not_exists(#createdAt, :createdAt), #updatedAt = :updatedAt, orgId = :orgId',
        ExpressionAttributeNames: {
          '#value': 'value',
          '#activeClientsCount': 'activeClientsCount',
          '#totalAccumulatedDebt': 'totalAccumulatedDebt',
          '#totalCreditLimit': 'totalCreditLimit',
          '#previousDayValue': 'previousDayValue',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':value': delinquentCount,
          ':activeClientsCount': activeClientsCount,
          ':totalAccumulatedDebt': totalAccumulatedDebt,
          ':totalCreditLimit': totalCreditLimit,
          ':previousDayValue': previousDayValue,
          ':createdAt': getCurrentTimestampInTimezone(),
          ':updatedAt': getCurrentTimestampInTimezone(),
          ':orgId': orgId,
        },
      }),
    );

    console.log(`[DelinquentMetrics] Successfully updated daily delinquent clients metrics for org ${orgId}`);
  } catch (error) {
    console.error('[DelinquentMetrics] Error updating daily delinquent clients metrics:', error);
    console.error('[DelinquentMetrics] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error)));
    // Don't throw - this is a non-critical operation
  }
}
