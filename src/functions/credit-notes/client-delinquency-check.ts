import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { getCurrentTimestampInTimezone } from '../shared/timezone-utils';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

const TABLE = process.env.TABLE_CREDIT_NOTES || 'credit-notes-dev';
const CLIENT_TABLE = process.env.TABLE_CLIENTS || 'clients-dev';

console.log('Client Delinquency Check Handler initialized');

/**
 * SQS handler for validating client delinquency status
 * Triggered when a credit note is deleted
 * 
 * Checks if the client still has any expired, unpaid credit notes
 * - If no unpaid expired notes exist → marks client as not delinquent
 * - If unpaid expired notes exist → keeps client marked as delinquent
 */
export const checkClientDelinquency = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  console.log('Client Delinquency Check handler triggered');
  console.log('Number of messages:', event.Records.length);

  const failedMessageIds: string[] = [];
  const results: Array<{
    messageId: string;
    clientId?: string;
    orgId?: string;
    status: 'success' | 'failed';
    delinquent?: boolean;
    reason?: string;
    error?: string;
  }> = [];

  for (const record of event.Records) {
    try {
      console.log('Processing SQS message:', record.messageId);

      // Parse the body (EventBridge sends the event as a string)
      const message = JSON.parse(record.body);
      const orgId = message.detail?.orgId || message.orgId;
      const clientId = message.detail?.clientId || message.clientId;
      const eventType = message.detail?.type || message.type;

      if (!orgId || !clientId) {
        console.error('Missing orgId or clientId in message:', record.body);
        throw new Error('Missing orgId or clientId in message');
      }

      console.log(
        `Checking delinquency for client ${clientId} in org ${orgId} (event: ${eventType})`,
      );

      // Query all credit notes for this client
      const notesResult = (await ddb.send(
        new QueryCommand({
          TableName: TABLE,
          IndexName: 'clientIdIndex',
          KeyConditionExpression: 'clientIdGSI = :clientId',
          ExpressionAttributeValues: {
            ':clientId': clientId,
          },
          ProjectionExpression: 'id, amount, paid, #status, dueDate',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
        }),
      )) as { Items?: Array<Record<string, any>> };

      const notes = notesResult.Items || [];
      const now = new Date();

      // Check if there are any expired, unpaid credit notes
      let hasUnpaidExpired = false;

      for (const note of notes) {
        const dueDate = new Date(note.dueDate);
        const isPastDue = now > dueDate;
        const paid = Number(note.paid ?? 0);
        const amount = Number(note.amount ?? 0);
        const isFullyPaid = paid >= amount;

        console.log(
          `Note ${note.id}: dueDate=${dueDate}, isPastDue=${isPastDue}, paid=${paid}, amount=${amount}, isFullyPaid=${isFullyPaid}`,
        );

        // If note is past due and not fully paid, client is delinquent
        if (isPastDue && !isFullyPaid) {
          hasUnpaidExpired = true;
          console.log(`Found unpaid expired note: ${note.id}`);
          break;
        }
      }

      console.log(
        `Client ${clientId} delinquency check: hasUnpaidExpired=${hasUnpaidExpired}`,
      );

      // Update client delinquency status based on findings
      const now_timestamp = getCurrentTimestampInTimezone();
      let delinquencyAction = 'maintained';

      if (!hasUnpaidExpired) {
        // No unpaid expired notes, mark client as not delinquent
        console.log(`Removing delinquent flag for client ${clientId}`);

        await ddb.send(
          new UpdateCommand({
            TableName: CLIENT_TABLE,
            Key: { PK: `org#${orgId}`, SK: `client#${clientId}` },
            UpdateExpression: 'SET #delinquent = :false, #updatedAt = :updatedAt',
            ExpressionAttributeNames: {
              '#delinquent': 'delinquent',
              '#updatedAt': 'updatedAt',
            },
            ExpressionAttributeValues: {
              ':false': false,
              ':updatedAt': now_timestamp,
            },
            ConditionExpression: 'attribute_exists(PK)',
          }),
        );

        delinquencyAction = 'cleared';
        console.log(`Client ${clientId} is no longer delinquent`);
      } else {
        console.log(
          `Client ${clientId} still has unpaid expired notes, keeping delinquent flag`,
        );
        delinquencyAction = 'maintained';
      }

      results.push({
        messageId: record.messageId,
        clientId,
        orgId,
        status: 'success',
        delinquent: hasUnpaidExpired,
        reason: delinquencyAction,
      });

      console.log(
        `Successfully checked delinquency for client ${clientId}: ${delinquencyAction}`,
      );
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

  console.log(
    'SQS batch processing complete:',
    JSON.stringify(results, null, 2),
  );

  // Return batch item failures - only these will NOT be deleted from the queue
  return {
    batchItemFailures: failedMessageIds.map(messageId => ({
      itemIdentifier: messageId,
    })),
  };
};

export default checkClientDelinquency;
