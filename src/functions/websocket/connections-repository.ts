import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  WebSocketConnection,
  WebSocketConnectionRecord,
} from '../notifications/types';

const TABLE = process.env.TABLE_WEBSOCKET_CONNECTIONS as string;
const USER_INDEX = 'byUser';

// Connection TTL: 24 hours (connections typically time out at 10 min but we keep record longer)
const CONNECTION_TTL_SECONDS = 24 * 60 * 60;

console.log('WebSocket Connections Repository initialized. TABLE:', TABLE);

if (!TABLE) {
  console.error('ERROR: TABLE_WEBSOCKET_CONNECTIONS environment variable is not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields before returning to callers.
 */
function toConnection(record: Record<string, unknown>): WebSocketConnection {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    ...rest
  } = record as unknown as WebSocketConnectionRecord;

  return rest as WebSocketConnection;
}

/**
 * Save a new WebSocket connection
 */
export async function saveConnection(
  connectionId: string,
  userId: string,
  metadata?: {
    userAgent?: string;
    sourceIp?: string;
  }
): Promise<WebSocketConnection> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;

  const record: WebSocketConnectionRecord = {
    PK: `connection#${connectionId}`,
    SK: `connection#${connectionId}`,
    GSI1PK: `user#${userId}`,
    GSI1SK: `connection#${now}#${connectionId}`,
    connectionId,
    userId,
    connectedAt: now,
    userAgent: metadata?.userAgent,
    sourceIp: metadata?.sourceIp,
    ttl,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: record,
    }),
  );

  return toConnection(record as unknown as Record<string, unknown>);
}

/**
 * Get a connection by connectionId
 */
export async function getConnection(
  connectionId: string
): Promise<WebSocketConnection | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: {
        PK: `connection#${connectionId}`,
        SK: `connection#${connectionId}`,
      },
    }),
  );

  return result.Item ? toConnection(result.Item) : null;
}

/**
 * Delete a connection when user disconnects
 */
export async function deleteConnection(connectionId: string): Promise<boolean> {
  try {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: {
          PK: `connection#${connectionId}`,
          SK: `connection#${connectionId}`,
        },
      }),
    );
    return true;
  } catch (error) {
    console.error('Error deleting connection:', error);
    return false;
  }
}

/**
 * Get all active connections for a user
 */
export async function getConnectionsByUserId(
  userId: string
): Promise<WebSocketConnection[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: USER_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `user#${userId}`,
      },
    }),
  );

  return (result.Items ?? []).map((item) => toConnection(item));
}

/**
 * Update last ping time for a connection (for heartbeat tracking)
 */
export async function updateConnectionPing(
  connectionId: string
): Promise<void> {
  const now = new Date().toISOString();
  const ttl = Math.floor(Date.now() / 1000) + CONNECTION_TTL_SECONDS;

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: `connection#${connectionId}`,
        SK: `connection#${connectionId}`,
      },
      UpdateExpression: 'SET lastPingAt = :ping, #ttl = :ttl',
      ExpressionAttributeNames: { '#ttl': 'ttl' },
      ExpressionAttributeValues: {
        ':ping': now,
        ':ttl': ttl,
      },
    }),
  );
}

/**
 * Get count of active connections for a user
 */
export async function getConnectionCount(userId: string): Promise<number> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: USER_INDEX,
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: {
        ':pk': `user#${userId}`,
      },
      Select: 'COUNT',
    }),
  );

  return result.Count ?? 0;
}
