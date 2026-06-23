import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  Notification,
  NotificationRecord,
  CreateNotificationInput,
  UpdateNotificationInput,
  ListNotificationsParams,
  ListNotificationsResult,
} from './types';

const TABLE = process.env.TABLE_NOTIFICATIONS as string;
const ORG_INDEX = 'byOrg';

console.log('Notifications Repository initialized. TABLE_NOTIFICATIONS:', TABLE);

if (!TABLE) {
  console.error('ERROR: TABLE_NOTIFICATIONS environment variable is not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Strip internal DynamoDB fields before returning to callers.
 */
function toNotification(record: Record<string, unknown>): Notification {
  const {
    PK: _pk,
    SK: _sk,
    GSI1PK: _gsi1pk,
    GSI1SK: _gsi1sk,
    ttl: _ttl,
    ...rest
  } = record as unknown as NotificationRecord;

  return rest as Notification;
}

/**
 * Generate sort key for notifications (ordered by createdAt DESC by default)
 * Format: notification#<reversedTimestamp>#<id>
 * Using reversed timestamp allows for DESC order with DynamoDB's default ASC scan
 */
function generateSK(createdAt: string, id: string): string {
  // For descending order queries, we use the timestamp directly
  // DynamoDB will use ScanIndexForward: false for DESC
  return `notification#${createdAt}#${id}`;
}

/**
 * Parse SK to extract notification ID
 */
function parseNotificationIdFromSK(sk: string): string {
  const parts = sk.split('#');
  return parts[parts.length - 1];
}

/**
 * Get a single notification by user and notification ID
 */
export async function getNotificationById(
  userId: string,
  notificationId: string
): Promise<Notification | null> {
  // We need to query by userId and find the notification with matching ID
  const pk = `user#${userId}`;
  
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: 'id = :id',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'notification#',
        ':id': notificationId,
      },
      Limit: 1,
    }),
  );

  const item = result.Items?.[0];
  return item ? toNotification(item) : null;
}

/**
 * Get notification by its full key (for internal use when we know the SK)
 */
export async function getNotificationByKey(
  pk: string,
  sk: string
): Promise<NotificationRecord | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
    }),
  );

  return result.Item as NotificationRecord | null;
}

/**
 * List notifications for a user with pagination and filters
 */
export async function listNotifications(
  params: ListNotificationsParams
): Promise<ListNotificationsResult> {
  const pk = `user#${params.userId}`;
  const keyCondition = 'PK = :pk AND begins_with(SK, :skPrefix)';
  const exprValues: Record<string, unknown> = {
    ':pk': pk,
    ':skPrefix': 'notification#',
  };

  const filterParts: string[] = [];

  // Filter by organization if specified
  if (params.orgId) {
    filterParts.push('orgId = :orgId');
    exprValues[':orgId'] = params.orgId;
  }

  // Filter unread only
  if (params.unreadOnly) {
    filterParts.push('#read = :read');
    exprValues[':read'] = false;
  }

  const exprNames: Record<string, string> = {};
  if (params.unreadOnly) {
    exprNames['#read'] = 'read';
  }

  // Query all notifications for counting
  const allItems: Notification[] = [];
  let unreadCount = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: exprValues,
        ...(filterParts.length > 0 && { FilterExpression: filterParts.join(' AND ') }),
        ...(Object.keys(exprNames).length > 0 && { ExpressionAttributeNames: exprNames }),
        ExclusiveStartKey: lastKey,
        ScanIndexForward: params.sortOrder === 'asc',
      }),
    );

    for (const item of result.Items ?? []) {
      const notification = toNotification(item);
      allItems.push(notification);
      if (!notification.read) {
        unreadCount++;
      }
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  // If filtering by unread only, we already counted correctly
  // Otherwise, recount unread from full list
  if (!params.unreadOnly) {
    // Query separately for unread count (without the unreadOnly filter)
    const unreadResult = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: keyCondition,
        FilterExpression: params.orgId 
          ? 'orgId = :orgId AND #read = :readFalse'
          : '#read = :readFalse',
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': 'notification#',
          ':readFalse': false,
          ...(params.orgId && { ':orgId': params.orgId }),
        },
        Select: 'COUNT',
      }),
    );
    unreadCount = unreadResult.Count ?? 0;
  }

  const total = allItems.length;
  const start = (params.page - 1) * params.limit;
  const paginatedItems = allItems.slice(start, start + params.limit);

  return {
    items: paginatedItems,
    total,
    unreadCount,
  };
}

/**
 * Create a new notification
 */
export async function createNotification(
  input: CreateNotificationInput
): Promise<Notification> {
  const now = new Date().toISOString();
  const notificationId = randomUUID();
  const pk = `user#${input.userId}`;
  const sk = generateSK(now, notificationId);

  // Calculate TTL if expiresAt is provided
  let ttl: number | undefined;
  if (input.expiresAt) {
    ttl = Math.floor(new Date(input.expiresAt).getTime() / 1000);
  }

  const record: NotificationRecord = {
    PK: pk,
    SK: sk,
    id: notificationId,
    userId: input.userId,
    orgId: input.orgId,
    type: input.type,
    priority: input.priority ?? 'normal',
    title: input.title,
    message: input.message,
    read: false,
    link: input.link,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
    createdAt: now,
    expiresAt: input.expiresAt,
    ...(input.orgId && {
      GSI1PK: `org#${input.orgId}`,
      GSI1SK: sk,
    }),
    ...(ttl && { ttl }),
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: record,
    }),
  );

  return toNotification(record as unknown as Record<string, unknown>);
}

/**
 * Update a notification (primarily for marking as read)
 */
export async function updateNotification(
  userId: string,
  notificationId: string,
  updates: UpdateNotificationInput
): Promise<Notification | null> {
  // First, find the notification to get its SK
  const existing = await getNotificationById(userId, notificationId);
  if (!existing) {
    return null;
  }

  const pk = `user#${userId}`;
  const sk = generateSK(existing.createdAt, notificationId);

  const updateExprParts: string[] = [];
  const exprNames: Record<string, string> = {};
  const exprValues: Record<string, unknown> = {};

  if (updates.read !== undefined) {
    updateExprParts.push('#read = :read');
    exprNames['#read'] = 'read';
    exprValues[':read'] = updates.read;
  }

  if (updates.readAt !== undefined) {
    updateExprParts.push('readAt = :readAt');
    exprValues[':readAt'] = updates.readAt;
  }

  if (updateExprParts.length === 0) {
    return existing;
  }

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
      UpdateExpression: `SET ${updateExprParts.join(', ')}`,
      ExpressionAttributeNames: Object.keys(exprNames).length > 0 ? exprNames : undefined,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return result.Attributes ? toNotification(result.Attributes as Record<string, unknown>) : null;
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  userId: string,
  notificationId: string
): Promise<boolean> {
  // First, find the notification to get its SK
  const existing = await getNotificationById(userId, notificationId);
  if (!existing) {
    return false;
  }

  const pk = `user#${userId}`;
  const sk = generateSK(existing.createdAt, notificationId);

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
    }),
  );

  return true;
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(
  userId: string,
  orgId?: string
): Promise<number> {
  const pk = `user#${userId}`;
  const now = new Date().toISOString();
  
  // Query all unread notifications
  const keyCondition = 'PK = :pk AND begins_with(SK, :skPrefix)';
  const exprValues: Record<string, unknown> = {
    ':pk': pk,
    ':skPrefix': 'notification#',
    ':readFalse': false,
  };

  let filterExpr = '#read = :readFalse';
  if (orgId) {
    filterExpr += ' AND orgId = :orgId';
    exprValues[':orgId'] = orgId;
  }

  const unreadItems: NotificationRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: keyCondition,
        FilterExpression: filterExpr,
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: exprValues,
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      unreadItems.push(item as NotificationRecord);
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  if (unreadItems.length === 0) {
    return 0;
  }

  // Update each notification (batch updates not supported, using individual updates)
  // For better performance with many items, consider using BatchWriteCommand with PutItem
  const updatePromises = unreadItems.map((item) =>
    ddb.send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { PK: item.PK, SK: item.SK },
        UpdateExpression: 'SET #read = :read, readAt = :readAt',
        ExpressionAttributeNames: { '#read': 'read' },
        ExpressionAttributeValues: {
          ':read': true,
          ':readAt': now,
        },
      }),
    ),
  );

  await Promise.all(updatePromises);
  return unreadItems.length;
}

/**
 * Get unread count for a user
 */
export async function getUnreadCount(userId: string, orgId?: string): Promise<number> {
  const pk = `user#${userId}`;
  
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      FilterExpression: orgId
        ? '#read = :readFalse AND orgId = :orgId'
        : '#read = :readFalse',
      ExpressionAttributeNames: { '#read': 'read' },
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'notification#',
        ':readFalse': false,
        ...(orgId && { ':orgId': orgId }),
      },
      Select: 'COUNT',
    }),
  );

  return result.Count ?? 0;
}

/**
 * Delete all notifications for a user (for cleanup/testing)
 */
export async function deleteAllNotifications(userId: string): Promise<number> {
  const pk = `user#${userId}`;
  
  // Query all notifications
  const allItems: { PK: string; SK: string }[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': 'notification#',
        },
        ProjectionExpression: 'PK, SK',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      allItems.push({ PK: item.PK as string, SK: item.SK as string });
    }
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  if (allItems.length === 0) {
    return 0;
  }

  // Delete in batches of 25 (DynamoDB limit)
  const batches = [];
  for (let i = 0; i < allItems.length; i += 25) {
    batches.push(allItems.slice(i, i + 25));
  }

  for (const batch of batches) {
    await ddb.send(
      new BatchWriteCommand({
        RequestItems: {
          [TABLE]: batch.map((item) => ({
            DeleteRequest: { Key: item },
          })),
        },
      }),
    );
  }

  return allItems.length;
}
