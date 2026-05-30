import { publishMetricsEvent } from './metrics-trigger';

/**
 * Publish credit usage calculation event to EventBridge → SQS → Lambda
 * Does not wait for response to avoid blocking the API
 */
export async function triggerCreditUsageCalculation(orgId: string): Promise<void> {
  try {
    await publishMetricsEvent('CreditUsageCalculationRequested', orgId);
  } catch (error) {
    // Don't fail the main operation if event publishing fails
    console.warn('Failed to publish credit usage calculation event:', error);
  }
}
