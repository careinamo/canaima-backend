import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import * as repo from './repository';

console.log('Credit Usage SQS Handler initialized');

/**
 * SQS handler for processing credit usage calculations
 * Receives messages from EventBridge -> SQS
 * Calculates and saves credit usage for organizations
 */
export const calculateCreditUsageSQS = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log('Credit Usage SQS handler triggered');
  console.log('Number of messages:', event.Records.length);

  const failedMessageIds: string[] = [];
  const results: Array<{
    messageId: string;
    orgId?: string;
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

      if (!orgId) {
        console.error('Missing orgId in message:', record.body);
        // Mark as failed so it goes to DLQ
        throw new Error('Missing orgId in message');
      }

      console.log(`Calculating credit usage for org: ${orgId}`);

      // Calculate usage
      const usage = await repo.calculateCreditUsage(orgId);
      console.log(`Calculation result:`, JSON.stringify(usage));

      // Save to DynamoDB
      const savedRecord = await repo.saveCreditUsageRecord(orgId, usage);
      console.log(`Saved credit usage record:`, JSON.stringify(savedRecord));

      results.push({
        messageId: record.messageId,
        orgId,
        status: 'success',
        data: savedRecord,
      });

      console.log(`Successfully processed credit usage for org: ${orgId}`);
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

export default calculateCreditUsageSQS;
