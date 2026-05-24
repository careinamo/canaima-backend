import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_WEBHOOK_EVENTS as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Check if a webhook event has already been processed (idempotency)
 */
export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: TABLE,
        Key: {
          PK: `WEBHOOK#CLERK`,
          SK: eventId,
        },
      }),
    );

    return !!result.Item;
  } catch (error) {
    console.error('Error checking webhook event:', error);
    return false;
  }
}

/**
 * Record a processed webhook event
 * TTL is set automatically by DynamoDB
 */
export async function recordWebhookEvent(eventId: string): Promise<void> {
  const now = Date.now();
  const ttl = Math.floor(now / 1000) + 24 * 60 * 60; // 24 hours from now

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: {
        PK: `WEBHOOK#CLERK`,
        SK: eventId,
        processedAt: new Date().toISOString(),
        ttl, // DynamoDB TTL
      },
    }),
  );
}
