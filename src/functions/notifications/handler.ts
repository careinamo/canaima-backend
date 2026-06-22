import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  ValidationError,
  validateCreateNotification,
  validateUpdateNotification,
  validateNotificationId,
} from './validators';
import * as repo from './repository';
import { getAuth } from '../shared/auth';
import { broadcastNotification } from './notification-service';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  },
  body: JSON.stringify(body),
});

const clientError = (statusCode: number, message: string) =>
  respond(statusCode, { error: message });

const serverError = () => respond(500, { error: 'Internal server error' });

console.log('TABLE_NOTIFICATIONS env var:', process.env.TABLE_NOTIFICATIONS);

// ---------------------------------------------------------------------------
// GET /notifications
// List notifications for the authenticated user
// ---------------------------------------------------------------------------

export const listNotifications = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const q = event.queryStringParameters ?? {};

    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '20', 10) || 20));
    const sortOrder: 'asc' | 'desc' = q.sortOrder === 'asc' ? 'asc' : 'desc';
    const unreadOnly = q.unreadOnly === 'true';

    const result = await repo.listNotifications({
      userId,
      orgId: q.orgId, // Optional filter by organization
      unreadOnly,
      page,
      limit,
      sortOrder,
    });

    return respond(200, {
      items: result.items,
      total: result.total,
      unreadCount: result.unreadCount,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(result.total / limit) || 1,
        totalCount: result.total,
        hasMore: page * limit < result.total,
      },
    });
  } catch (error) {
    console.error('listNotifications error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /notifications/{id}
// Get a single notification by ID
// ---------------------------------------------------------------------------

export const getNotification = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return clientError(400, 'Missing notification id');
    }

    try {
      validateNotificationId(id);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    const notification = await repo.getNotificationById(userId, id);
    if (!notification) {
      return clientError(404, 'Notification not found');
    }

    return respond(200, notification);
  } catch (error) {
    console.error('getNotification error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /notifications
// Create a new notification (typically called internally by other services)
// ---------------------------------------------------------------------------

export const createNotification = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    
    // Only allow creating notifications for the authenticated user
    // or from internal services (check for internal header)
    const isInternal = event.headers['x-internal-request'] === 'true';
    
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    let input;
    try {
      input = validateCreateNotification(body);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    // If not internal request, ensure user can only create notifications for themselves
    if (!isInternal && input.userId !== auth.userId) {
      return clientError(403, 'Cannot create notifications for other users');
    }

    const notification = await repo.createNotification(input);

    // Broadcast notification via WebSocket to connected clients
    try {
      await broadcastNotification(notification);
    } catch (broadcastError) {
      // Don't fail the request if broadcast fails - notification is already saved
      console.error('Failed to broadcast notification:', broadcastError);
    }

    return respond(201, notification);
  } catch (error) {
    console.error('createNotification error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PATCH /notifications/{id}
// Update a notification (primarily for marking as read)
// ---------------------------------------------------------------------------

export const updateNotification = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return clientError(400, 'Missing notification id');
    }

    try {
      validateNotificationId(id);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    let updates;
    try {
      updates = validateUpdateNotification(body);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    const updated = await repo.updateNotification(userId, id, updates);
    if (!updated) {
      return clientError(404, 'Notification not found');
    }

    return respond(200, updated);
  } catch (error) {
    console.error('updateNotification error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PATCH /notifications/{id}/read
// Shorthand endpoint to mark a notification as read
// ---------------------------------------------------------------------------

export const markNotificationRead = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return clientError(400, 'Missing notification id');
    }

    try {
      validateNotificationId(id);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    const updated = await repo.updateNotification(userId, id, {
      read: true,
      readAt: new Date().toISOString(),
    });

    if (!updated) {
      return clientError(404, 'Notification not found');
    }

    return respond(200, updated);
  } catch (error) {
    console.error('markNotificationRead error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PATCH /notifications/read-all
// Mark all notifications as read for the authenticated user
// ---------------------------------------------------------------------------

export const markAllNotificationsRead = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const q = event.queryStringParameters ?? {};
    const orgId = q.orgId; // Optional: only mark read for specific org

    const count = await repo.markAllNotificationsAsRead(userId, orgId);

    return respond(200, {
      success: true,
      message: `Marked ${count} notification(s) as read`,
      count,
    });
  } catch (error) {
    console.error('markAllNotificationsRead error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// DELETE /notifications/{id}
// Delete a notification
// ---------------------------------------------------------------------------

export const deleteNotification = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const id = event.pathParameters?.id;
    if (!id) {
      return clientError(400, 'Missing notification id');
    }

    try {
      validateNotificationId(id);
    } catch (error) {
      if (error instanceof ValidationError) {
        return clientError(400, error.message);
      }
      throw error;
    }

    const deleted = await repo.deleteNotification(userId, id);
    if (!deleted) {
      return clientError(404, 'Notification not found');
    }

    return respond(200, {
      success: true,
      message: 'Notification deleted',
    });
  } catch (error) {
    console.error('deleteNotification error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /notifications/unread-count
// Get the count of unread notifications for the authenticated user
// ---------------------------------------------------------------------------

export const getUnreadCount = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const auth = getAuth(event);
    const userId = auth.userId;

    if (!userId) {
      return clientError(401, 'Unauthorized');
    }

    const q = event.queryStringParameters ?? {};
    const orgId = q.orgId; // Optional: filter by organization

    const unreadCount = await repo.getUnreadCount(userId, orgId);

    return respond(200, { unreadCount });
  } catch (error) {
    console.error('getUnreadCount error:', error);
    return serverError();
  }
};
