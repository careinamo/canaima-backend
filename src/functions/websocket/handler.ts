import type {
  APIGatewayProxyWebsocketEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as connectionsRepo from './connections-repository';
import * as notificationsRepo from '../notifications/repository';
import { sendToConnection, sendToUser } from './send-message';
import type {
  WebSocketMessage,
  ConnectionAckPayload,
  WebSocketClientMessage,
  NotificationPayload,
  ErrorPayload,
} from '../notifications/types';

// Clerk JWKS URL for token verification
const CLERK_JWKS_URL = process.env.CLERK_JWKS_URL || 'https://live-spaniel-88.clerk.accounts.dev/.well-known/jwks.json';
const CLERK_ISSUER = process.env.CLERK_ISSUER || 'https://live-spaniel-88.clerk.accounts.dev';

// Heartbeat interval in milliseconds (client should ping every 5 minutes)
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

// Cache JWKS for performance
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(CLERK_JWKS_URL));
  }
  return jwks;
}

/**
 * Verify JWT token from query string
 */
async function verifyToken(token: string): Promise<{ userId: string; orgId?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      issuer: CLERK_ISSUER,
    });

    const userId = payload.sub;
    if (!userId) {
      console.error('Token missing sub claim');
      return null;
    }

    // Extract org_id if present (Clerk organization sessions)
    const orgId = (payload as any).org_id;

    return { userId, orgId };
  } catch (error) {
    console.error('Token verification failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// $connect - Handle new WebSocket connection
// ---------------------------------------------------------------------------

export const connect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  console.log('WebSocket $connect:', connectionId);

  try {
    // Get token from query string
    const token = event.queryStringParameters?.token;
    
    if (!token) {
      console.error('No token provided');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized: No token provided' }),
      };
    }

    // Verify the token
    const auth = await verifyToken(token);
    if (!auth) {
      console.error('Invalid token');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized: Invalid token' }),
      };
    }

    // Extract metadata from request
    const userAgent = event.headers?.['User-Agent'] || event.headers?.['user-agent'];
    const sourceIp = event.requestContext.identity?.sourceIp;

    // Save connection to DynamoDB
    await connectionsRepo.saveConnection(connectionId, auth.userId, {
      userAgent,
      sourceIp,
    });

    console.log(`Connection saved: ${connectionId} for user ${auth.userId}`);

    return { statusCode: 200, body: 'Connected' };
  } catch (error) {
    console.error('$connect error:', error);
    return { statusCode: 500, body: 'Connection failed' };
  }
};

// ---------------------------------------------------------------------------
// $disconnect - Handle WebSocket disconnection
// ---------------------------------------------------------------------------

export const disconnect = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  console.log('WebSocket $disconnect:', connectionId);

  try {
    await connectionsRepo.deleteConnection(connectionId);
    console.log(`Connection deleted: ${connectionId}`);
    return { statusCode: 200, body: 'Disconnected' };
  } catch (error) {
    console.error('$disconnect error:', error);
    return { statusCode: 500, body: 'Disconnect cleanup failed' };
  }
};

// ---------------------------------------------------------------------------
// $default - Handle incoming WebSocket messages
// ---------------------------------------------------------------------------

export const defaultHandler = async (
  event: APIGatewayProxyWebsocketEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const connectionId = event.requestContext.connectionId;
  const domainName = event.requestContext.domainName;
  const stage = event.requestContext.stage;
  const endpoint = `https://${domainName}/${stage}`;

  console.log('WebSocket $default:', connectionId, 'body:', event.body);

  try {
    // Get connection info
    const connection = await connectionsRepo.getConnection(connectionId);
    if (!connection) {
      console.error('Connection not found:', connectionId);
      return { statusCode: 410, body: 'Connection not found' };
    }

    // Parse the message
    let message: WebSocketClientMessage;
    try {
      message = JSON.parse(event.body || '{}');
    } catch {
      await sendToConnection(endpoint, connectionId, {
        type: 'error',
        payload: { code: 'INVALID_JSON', message: 'Invalid JSON message' } as ErrorPayload,
        timestamp: new Date().toISOString(),
      });
      return { statusCode: 400, body: 'Invalid JSON' };
    }

    // Handle different actions
    switch (message.action) {
      case 'heartbeat':
        await handleHeartbeat(connectionId, endpoint);
        break;

      case 'markRead':
        await handleMarkRead(connection.userId, message.notificationId, connectionId, endpoint);
        break;

      case 'markAllRead':
        await handleMarkAllRead(connection.userId, message.orgId, connectionId, endpoint);
        break;

      case 'subscribe':
        // Currently, subscription is implicit on connection
        // This could be extended for channel-based subscriptions
        await sendToConnection(endpoint, connectionId, {
          type: 'connection_ack',
          payload: {
            connectionId,
            userId: connection.userId,
            serverTime: new Date().toISOString(),
            heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
          } as ConnectionAckPayload,
          timestamp: new Date().toISOString(),
        });
        break;

      default:
        await sendToConnection(endpoint, connectionId, {
          type: 'error',
          payload: {
            code: 'UNKNOWN_ACTION',
            message: `Unknown action: ${message.action}`,
          } as ErrorPayload,
          timestamp: new Date().toISOString(),
        });
    }

    return { statusCode: 200, body: 'OK' };
  } catch (error) {
    console.error('$default error:', error);
    return { statusCode: 500, body: 'Internal error' };
  }
};

/**
 * Handle heartbeat/ping from client
 */
async function handleHeartbeat(
  connectionId: string,
  endpoint: string
): Promise<void> {
  await connectionsRepo.updateConnectionPing(connectionId);
  
  await sendToConnection(endpoint, connectionId, {
    type: 'heartbeat',
    payload: { serverTime: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle mark notification as read
 */
async function handleMarkRead(
  userId: string,
  notificationId: string | undefined,
  connectionId: string,
  endpoint: string
): Promise<void> {
  if (!notificationId) {
    await sendToConnection(endpoint, connectionId, {
      type: 'error',
      payload: {
        code: 'MISSING_NOTIFICATION_ID',
        message: 'notificationId is required',
      } as ErrorPayload,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const updated = await notificationsRepo.updateNotification(userId, notificationId, {
    read: true,
    readAt: new Date().toISOString(),
  });

  if (!updated) {
    await sendToConnection(endpoint, connectionId, {
      type: 'error',
      payload: {
        code: 'NOTIFICATION_NOT_FOUND',
        message: 'Notification not found',
      } as ErrorPayload,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Broadcast to all user's connections that this notification was read
  await sendToUser(userId, endpoint, {
    type: 'notification_read',
    payload: { notificationId, readAt: updated.readAt },
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle mark all notifications as read
 */
async function handleMarkAllRead(
  userId: string,
  orgId: string | undefined,
  connectionId: string,
  endpoint: string
): Promise<void> {
  const count = await notificationsRepo.markAllNotificationsAsRead(userId, orgId);

  // Broadcast to all user's connections
  await sendToUser(userId, endpoint, {
    type: 'notifications_read_all',
    payload: { count, orgId, readAt: new Date().toISOString() },
    timestamp: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// sendNotification - Send notification to a user via WebSocket
// This is called by other services when a new notification is created
// ---------------------------------------------------------------------------

export const sendNotification = async (
  userId: string,
  notification: NotificationPayload,
  endpoint: string
): Promise<{ sent: number; failed: number }> => {
  const message: WebSocketMessage<NotificationPayload> = {
    type: 'notification',
    payload: notification,
    timestamp: new Date().toISOString(),
  };

  return sendToUser(userId, endpoint, message);
};
