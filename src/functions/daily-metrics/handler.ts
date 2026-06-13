import type { ScheduledEvent } from 'aws-lambda';
import { copyDelinquentMetricsFromPreviousDay } from '../shared/delinquent-metrics-trigger';

console.log('Daily Metrics Lambda initialized');

/**
 * Scheduled handler for daily metrics processing - runs every 24 hours at midnight
 * Ensures continuity of daily metrics by copying from previous day if no updates occurred
 * 
 * Add new metric copy functions here as needed
 */
export async function dailyMetricsHandler(event: ScheduledEvent): Promise<{
  statusCode: number;
  body: string;
}> {
  try {
    console.log('Daily Metrics scheduled handler triggered');
    console.log('Event:', JSON.stringify(event, null, 2));

    const orgIds = (event.detail as any)?.orgIds || (process.env.ORG_IDS?.split(',') ?? ['org-default']);

    const delinquentMetricsCopyResults = [];

    for (const orgId of orgIds) {
      const trimmedOrgId = orgId.trim();

      // Copy delinquent clients metrics from previous day if today's record doesn't exist
      const copyResult = await copyDelinquentMetricsFromPreviousDay(trimmedOrgId);
      delinquentMetricsCopyResults.push({ orgId: trimmedOrgId, ...copyResult });

      // TODO: Add more metric copy functions here as needed
      // Example:
      // const creditUsageCopyResult = await copyCreditUsageMetricsFromPreviousDay(trimmedOrgId);
      // creditUsageMetricsCopyResults.push({ orgId: trimmedOrgId, ...creditUsageCopyResult });
    }

    console.log('Daily metrics copy results:', JSON.stringify(delinquentMetricsCopyResults, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Daily metrics processed successfully for all organizations',
        delinquentMetricsCopyResults,
      }),
    };
  } catch (error) {
    console.error('Error in daily metrics handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
