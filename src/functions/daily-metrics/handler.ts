import type { ScheduledEvent } from 'aws-lambda';
import { copyDelinquentMetricsFromPreviousDay } from '../shared/delinquent-metrics-trigger';
import { copyCreditUsageFromPreviousDay } from '../credit-usage/repository';

console.log('Daily Metrics Lambda initialized');

/**
 * Scheduled handler for daily metrics processing - runs every 24 hours at midnight
 * Ensures continuity of daily metrics by copying from previous day if no updates occurred
 * 
 * Currently handles:
 * - CreditUsed: Credit usage percentage per organization
 * - DelinquentClientsTotal: Count of delinquent clients per organization
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

    const creditUsageCopyResults = [];
    const delinquentMetricsCopyResults = [];

    for (const orgId of orgIds) {
      const trimmedOrgId = orgId.trim();

      // Copy credit usage metrics from previous day if today's record doesn't exist
      const creditUsageResult = await copyCreditUsageFromPreviousDay(trimmedOrgId);
      creditUsageCopyResults.push({ orgId: trimmedOrgId, ...creditUsageResult });

      // Copy delinquent clients metrics from previous day if today's record doesn't exist
      const delinquentResult = await copyDelinquentMetricsFromPreviousDay(trimmedOrgId);
      delinquentMetricsCopyResults.push({ orgId: trimmedOrgId, ...delinquentResult });

      // TODO: Add more metric copy functions here as needed
    }

    console.log('Credit usage copy results:', JSON.stringify(creditUsageCopyResults, null, 2));
    console.log('Delinquent metrics copy results:', JSON.stringify(delinquentMetricsCopyResults, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Daily metrics processed successfully for all organizations',
        creditUsageCopyResults,
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
