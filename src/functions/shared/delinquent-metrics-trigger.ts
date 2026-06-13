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
 * Stores the metric with SK as YYYY-MM-DD (daily)
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

    // Update/create the daily metrics record
    console.log(`[DelinquentMetrics] About to save: delinquentCount=${delinquentCount}`);
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
          'SET #value = :value, #activeClientsCount = :activeClientsCount, #totalAccumulatedDebt = :totalAccumulatedDebt, #totalCreditLimit = :totalCreditLimit, #createdAt = if_not_exists(#createdAt, :createdAt), #updatedAt = :updatedAt, orgId = :orgId',
        ExpressionAttributeNames: {
          '#value': 'value',
          '#activeClientsCount': 'activeClientsCount',
          '#totalAccumulatedDebt': 'totalAccumulatedDebt',
          '#totalCreditLimit': 'totalCreditLimit',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':value': delinquentCount,
          ':activeClientsCount': activeClientsCount,
          ':totalAccumulatedDebt': totalAccumulatedDebt,
          ':totalCreditLimit': totalCreditLimit,
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

/**
 * Copy delinquent clients metric from previous day if today's record doesn't exist
 * Called by the scheduled handler (every 24 hours) to ensure continuity
 */
export async function copyDelinquentMetricsFromPreviousDay(orgId: string, date: Date = new Date()): Promise<{
  copied: boolean;
  reason: string;
}> {
  console.log(`[DelinquentMetrics] Checking if copy from previous day is needed for org ${orgId}`);
  
  if (!METRICS_TABLE) {
    console.error('[DelinquentMetrics] ERROR: METRICS_TABLE is not defined!');
    return { copied: false, reason: 'METRICS_TABLE not defined' };
  }

  try {
    const dateString = date.toISOString().slice(0, 10); // e.g., "2026-06-13"
    const pk = `DelinquentClientsTotal#${orgId}`;

    // Check if today's record already exists
    const todayResult = await ddb.send(
      new GetCommand({
        TableName: METRICS_TABLE,
        Key: { PK: pk, SK: dateString },
      }),
    );

    if (todayResult.Item) {
      console.log(`[DelinquentMetrics] Today's record already exists for ${dateString}, skipping copy`);
      return { copied: false, reason: 'Today record already exists' };
    }

    // Get previous day's record
    const previousDay = new Date(date);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDateString = previousDay.toISOString().slice(0, 10);

    const previousDayResult = await ddb.send(
      new GetCommand({
        TableName: METRICS_TABLE,
        Key: { PK: pk, SK: previousDateString },
      }),
    );

    if (!previousDayResult.Item) {
      console.log(`[DelinquentMetrics] No previous day record found for ${previousDateString}, nothing to copy`);
      return { copied: false, reason: 'No previous day record exists' };
    }

    // Copy previous day's record to today with same value
    const previousRecord = previousDayResult.Item;
    console.log(`[DelinquentMetrics] Copying previous day record to ${dateString}, value: ${previousRecord.value}`);

    await ddb.send(
      new UpdateCommand({
        TableName: METRICS_TABLE,
        Key: { PK: pk, SK: dateString },
        UpdateExpression:
          'SET #value = :value, #activeClientsCount = :activeClientsCount, #totalAccumulatedDebt = :totalAccumulatedDebt, #totalCreditLimit = :totalCreditLimit, #createdAt = :createdAt, #updatedAt = :updatedAt, orgId = :orgId',
        ExpressionAttributeNames: {
          '#value': 'value',
          '#activeClientsCount': 'activeClientsCount',
          '#totalAccumulatedDebt': 'totalAccumulatedDebt',
          '#totalCreditLimit': 'totalCreditLimit',
          '#createdAt': 'createdAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':value': previousRecord.value,
          ':activeClientsCount': previousRecord.activeClientsCount ?? 0,
          ':totalAccumulatedDebt': previousRecord.totalAccumulatedDebt ?? 0,
          ':totalCreditLimit': previousRecord.totalCreditLimit ?? 0,
          ':createdAt': getCurrentTimestampInTimezone(),
          ':updatedAt': getCurrentTimestampInTimezone(),
          ':orgId': orgId,
        },
      }),
    );

    console.log(`[DelinquentMetrics] Successfully copied previous day metrics to ${dateString}`);
    return { copied: true, reason: 'Copied from previous day' };
  } catch (error) {
    console.error('[DelinquentMetrics] Error copying previous day metrics:', error);
    return { copied: false, reason: error instanceof Error ? error.message : 'Unknown error' };
  }
}
