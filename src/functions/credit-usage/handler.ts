import type { ScheduledEvent } from 'aws-lambda';
import * as repo from './repository';
import { copyDelinquentMetricsFromPreviousDay } from '../shared/delinquent-metrics-trigger';

console.log('Credit Usage Lambda initialized');

/**
 * Calculate and save credit usage for a single organization
 * Can be called:
 * 1. By EventBridge schedule (every 24 hours)
 * 2. By credit-notes or payments after create/update/delete operations
 */
export async function calculateCreditUsageForOrg(orgId: string): Promise<{
  success: boolean;
  data?: any;
  error?: string;
}> {
  try {
    console.log(`Calculating credit usage for org: ${orgId}`);

    // Calculate usage
    const usage = await repo.calculateCreditUsage(orgId);
    console.log(`Calculation result: ${JSON.stringify(usage)}`);

    // Save to DynamoDB
    const record = await repo.saveCreditUsageRecord(orgId, usage);
    console.log(`Saved credit usage record: ${JSON.stringify(record)}`);

    return {
      success: true,
      data: record,
    };
  } catch (error) {
    console.error(`Error calculating credit usage for org ${orgId}:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Scheduled handler - runs every 24 hours
 * Receives a list of organization IDs to process
 */
export async function scheduleHandler(event: ScheduledEvent): Promise<{
  statusCode: number;
  body: string;
}> {
  try {
    console.log('Credit Usage scheduled handler triggered');
    console.log('Event:', JSON.stringify(event, null, 2));

    // For a scheduled trigger, we expect the detail to contain organization IDs
    // If no details provided, you can hardcode the orgs or fetch them from a config
    // For now, we'll process based on environment variable or event detail
    const orgIds = (event.detail as any)?.orgIds || (process.env.ORG_IDS?.split(',') ?? ['org-default']);

    const results = [];
    const delinquentMetricsCopyResults = [];

    for (const orgId of orgIds) {
      const trimmedOrgId = orgId.trim();
      
      // Calculate credit usage
      const result = await calculateCreditUsageForOrg(trimmedOrgId);
      results.push({ orgId: trimmedOrgId, result });

      // Copy delinquent metrics from previous day if today's record doesn't exist
      const copyResult = await copyDelinquentMetricsFromPreviousDay(trimmedOrgId);
      delinquentMetricsCopyResults.push({ orgId: trimmedOrgId, ...copyResult });
    }

    console.log('Scheduled calculation complete:', JSON.stringify(results, null, 2));
    console.log('Delinquent metrics copy results:', JSON.stringify(delinquentMetricsCopyResults, null, 2));

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Credit usage calculated successfully for all organizations',
        results,
        delinquentMetricsCopyResults,
      }),
    };
  } catch (error) {
    console.error('Error in scheduled handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}

/**
 * Event-driven handler - called from credit-notes or payments after mutations
 * Can be invoked via:
 * 1. Internal Lambda invocation from credit-notes/payments
 * 2. SNS topic subscription
 * 3. SQS queue
 */
export async function eventDrivenHandler(event: any): Promise<{
  statusCode: number;
  body: string;
}> {
  try {
    console.log('Credit Usage event-driven handler triggered');
    console.log('Event:', JSON.stringify(event, null, 2));

    const orgId = event.orgId || event.detail?.orgId;
    if (!orgId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing orgId in event' }),
      };
    }

    const result = await calculateCreditUsageForOrg(orgId);

    return {
      statusCode: result.success ? 200 : 500,
      body: JSON.stringify(result),
    };
  } catch (error) {
    console.error('Error in event-driven handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
