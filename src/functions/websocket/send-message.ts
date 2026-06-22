import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';
import * as connectionsRepo from './connections-repository';
import type { WebSocketMessage } from '../notifications/types';

// Cache clients by endpoint
const clientCache = new Map<string, ApiGatewayManagementApiClient>();

/**
 * Get or create an API Gateway Management API client for the given endpoint
 */
function getClient(endpoint: string): ApiGatewayManagementApiClient {
  let client = clientCache.get(endpoint);
  if (!client) {
    client = new ApiGatewayManagementApiClient({
      endpoint,
    });
    clientCache.set(endpoint, client);
  }
  return client;
}

/**
 * Send a message to a specific WebSocket connection
 * Returns true if successful, false if the connection is gone
 */
export async function sendToConnection<T>(
  endpoint: string,
  connectionId: string,
  message: WebSocketMessage<T>
): Promise<boolean> {
  const client = getClient(endpoint);

  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: Buffer.from(JSON.stringify(message)),
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof GoneException) {
      // Connection is no longer valid, clean it up
      console.log(`Connection ${connectionId} is gone, cleaning up`);
      await connectionsRepo.deleteConnection(connectionId);
      return false;
    }
    console.error(`Error sending to connection ${connectionId}:`, error);
    throw error;
  }
}

/**
 * Send a message to all active connections for a user
 * Returns count of successful and failed sends
 */
export async function sendToUser<T>(
  userId: string,
  endpoint: string,
  message: WebSocketMessage<T>
): Promise<{ sent: number; failed: number }> {
  const connections = await connectionsRepo.getConnectionsByUserId(userId);
  
  if (connections.length === 0) {
    console.log(`No active connections for user ${userId}`);
    return { sent: 0, failed: 0 };
  }

  console.log(`Sending message to ${connections.length} connection(s) for user ${userId}`);

  const results = await Promise.allSettled(
    connections.map((conn) => sendToConnection(endpoint, conn.connectionId, message)),
  );

  let sent = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}

/**
 * Send a message to all connections for multiple users
 */
export async function sendToUsers<T>(
  userIds: string[],
  endpoint: string,
  message: WebSocketMessage<T>
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.all(
    userIds.map((userId) => sendToUser(userId, endpoint, message)),
  );

  return results.reduce(
    (acc, result) => ({
      sent: acc.sent + result.sent,
      failed: acc.failed + result.failed,
    }),
    { sent: 0, failed: 0 },
  );
}

/**
 * Broadcast a message to all connections (use sparingly)
 */
export async function broadcast<T>(
  endpoint: string,
  message: WebSocketMessage<T>,
  connectionIds: string[]
): Promise<{ sent: number; failed: number }> {
  const results = await Promise.allSettled(
    connectionIds.map((connId) => sendToConnection(endpoint, connId, message)),
  );

  let sent = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      sent++;
    } else {
      failed++;
    }
  }

  return { sent, failed };
}
