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
 * Update the delinquent clients count metric for an organization
 * Queries all clients and counts how many are marked as delinquent
 * Also gathers additional context metrics
 */
export async function updateDelinquentClientsMetrics(orgId: string, date: Date = new Date()): Promise<void> {
  try {
    // Format date as YYYY-MM-DD for the SK
    const dateString = date.toISOString().split('T')[0]; // e.g., "2026-05-30"

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
      const isActive = (client.status as string) === 'active' || client.status === undefined;
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

    // Check if value has changed since yesterday to decide if we need to copy
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayString = yesterday.toISOString().split('T')[0];

    const yesterdayMetricsKey = {
      PK: `DelinquentClientsCount#${orgId}`,
      SK: yesterdayString,
    };

    let yesterdayValue: number | undefined;

    try {
      const yesterdayResult = await ddb.send(
        new GetCommand({
          TableName: METRICS_TABLE,
          Key: yesterdayMetricsKey,
        }),
      );

      yesterdayValue = (yesterdayResult.Item?.value as number) || undefined;
    } catch (e) {
      // Yesterday's record doesn't exist, that's ok
    }

    // If value hasn't changed and yesterday exists, just copy yesterday's record to today
    if (yesterdayValue !== undefined && yesterdayValue === delinquentCount) {
      console.log(
        `Delinquent clients count unchanged (${delinquentCount}). Copying yesterday's record.`,
      );

      const today = dateString;
      const metricsKey = {
        PK: `DelinquentClientsCount#${orgId}`,
        SK: today,
      };

      await ddb.send(
        new UpdateCommand({
          TableName: METRICS_TABLE,
          Key: metricsKey,
          UpdateExpression:
            'SET #value = :value, #activeClientsCount = :activeClientsCount, #totalAccumulatedDebt = :totalAccumulatedDebt, #totalCreditLimit = :totalCreditLimit, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#value': 'value',
            '#activeClientsCount': 'activeClientsCount',
            '#totalAccumulatedDebt': 'totalAccumulatedDebt',
            '#totalCreditLimit': 'totalCreditLimit',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':value': delinquentCount,
            ':activeClientsCount': activeClientsCount,
            ':totalAccumulatedDebt': totalAccumulatedDebt,
            ':totalCreditLimit': totalCreditLimit,
            ':updatedAt': getCurrentTimestampInTimezone(),
          },
        }),
      );
    } else {
      // Value has changed or it's the first day, create/update the record
      console.log(`Delinquent clients count updated: ${delinquentCount}`);

      const metricsKey = {
        PK: `DelinquentClientsCount#${orgId}`,
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
    }
  } catch (error) {
    console.error('Error updating delinquent clients metrics:', error);
    // Don't throw - this is a non-critical operation
  }
}
