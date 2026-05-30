import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import * as creditUsageRepo from './repository';
import * as creditNotesRepo from '../credit-notes/repository';

console.log('Unified Metrics Handler initialized');

/**
 * Unified SQS handler for processing all metrics calculations
 * Receives messages from EventBridge -> SQS
 * Routes to appropriate handler based on event type:
 * - CreditUsageCalculationRequested: calculates credit usage percentage
 * - CreditNoteMetricsUpdateRequested: updates monthly credit notes totals
 */
export const calculateMetrics = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log('Metrics SQS handler triggered');
  console.log('Number of messages:', event.Records.length);

  const failedMessageIds: string[] = [];
  const results: Array<{
    messageId: string;
    orgId?: string;
    eventType?: string;
    status: 'success' | 'failed';
    data?: any;
    error?: string;
  }> = [];

  for (const record of event.Records) {
    try {
      console.log('Processing SQS message:', record.messageId);

      // Parse the body (EventBridge sends the event as a string)
      const message = JSON.parse(record.body);
      const orgId = message.detail?.orgId || message.orgId;
      const eventType = message.detail?.type || message.type;

      if (!orgId) {
        console.error('Missing orgId in message:', record.body);
        throw new Error('Missing orgId in message');
      }

      if (!eventType) {
        console.error('Missing event type in message:', record.body);
        throw new Error('Missing event type in message');
      }

      console.log(`Processing ${eventType} for org: ${orgId}`);

      let result: any;

      // Route to appropriate handler based on event type
      if (eventType === 'CreditUsageCalculationRequested') {
        // Calculate credit usage percentage
        const usage = await creditUsageRepo.calculateCreditUsage(orgId);
        result = await creditUsageRepo.saveCreditUsageRecord(orgId, usage);
        console.log(`Saved credit usage record for org ${orgId}:`, JSON.stringify(result));
      } else if (eventType === 'CreditNoteMetricsUpdateRequested') {
        // Update monthly credit notes metrics
        await creditNotesRepo.updateMonthlyCreditNotesMetrics(orgId);
        result = { type: 'monthly_metrics_updated', orgId };
        console.log(`Updated monthly credit notes metrics for org ${orgId}`);
      } else {
        throw new Error(`Unknown event type: ${eventType}`);
      }

      results.push({
        messageId: record.messageId,
        orgId,
        eventType,
        status: 'success',
        data: result,
      });

      console.log(`Successfully processed ${eventType} for org: ${orgId}`);
    } catch (error) {
      console.error(`Error processing SQS message ${record.messageId}:`, error);

      failedMessageIds.push(record.messageId);
      results.push({
        messageId: record.messageId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  console.log('SQS batch processing complete:', JSON.stringify(results, null, 2));

  // Return batch item failures - only these will NOT be deleted from the queue
  return {
    batchItemFailures: failedMessageIds.map(messageId => ({
      itemIdentifier: messageId,
    })),
  };
};

export default calculateMetrics;
