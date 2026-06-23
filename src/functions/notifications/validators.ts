import type { CreateNotificationInput, UpdateNotificationInput, NotificationType, NotificationPriority } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const VALID_NOTIFICATION_TYPES: NotificationType[] = [
  'credit_note_created',
  'credit_note_updated',
  'credit_note_deleted',
  'credit_note_expired',
  'credit_note_paid',
  'payment_created',
  'payment_updated',
  'payment_deleted',
  'client_created',
  'client_delinquent',
  'report_ready',
  'org_invite',
  'system',
];

const VALID_PRIORITIES: NotificationPriority[] = ['low', 'normal', 'high', 'urgent'];

export function validateCreateNotification(body: unknown): CreateNotificationInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body is required');
  }

  const data = body as Record<string, unknown>;

  // Required fields
  if (!data.userId || typeof data.userId !== 'string' || data.userId.trim() === '') {
    throw new ValidationError('userId is required and must be a non-empty string');
  }

  if (!data.type || typeof data.type !== 'string') {
    throw new ValidationError('type is required and must be a string');
  }

  if (!VALID_NOTIFICATION_TYPES.includes(data.type as NotificationType)) {
    throw new ValidationError(`type must be one of: ${VALID_NOTIFICATION_TYPES.join(', ')}`);
  }

  if (!data.title || typeof data.title !== 'string' || data.title.trim() === '') {
    throw new ValidationError('title is required and must be a non-empty string');
  }

  if (!data.message || typeof data.message !== 'string' || data.message.trim() === '') {
    throw new ValidationError('message is required and must be a non-empty string');
  }

  // Optional fields validation
  if (data.orgId !== undefined && typeof data.orgId !== 'string') {
    throw new ValidationError('orgId must be a string');
  }

  if (data.priority !== undefined) {
    if (!VALID_PRIORITIES.includes(data.priority as NotificationPriority)) {
      throw new ValidationError(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
    }
  }

  if (data.link !== undefined && typeof data.link !== 'string') {
    throw new ValidationError('link must be a string');
  }

  if (data.resourceType !== undefined && typeof data.resourceType !== 'string') {
    throw new ValidationError('resourceType must be a string');
  }

  if (data.resourceId !== undefined && typeof data.resourceId !== 'string') {
    throw new ValidationError('resourceId must be a string');
  }

  if (data.metadata !== undefined && typeof data.metadata !== 'object') {
    throw new ValidationError('metadata must be an object');
  }

  if (data.expiresAt !== undefined) {
    if (typeof data.expiresAt !== 'string') {
      throw new ValidationError('expiresAt must be an ISO 8601 date string');
    }
    const expiresDate = new Date(data.expiresAt);
    if (isNaN(expiresDate.getTime())) {
      throw new ValidationError('expiresAt must be a valid ISO 8601 date string');
    }
  }

  return {
    userId: data.userId.trim(),
    orgId: data.orgId ? (data.orgId as string).trim() : undefined,
    type: data.type as NotificationType,
    priority: (data.priority as NotificationPriority) || 'normal',
    title: data.title.trim(),
    message: data.message.trim(),
    link: data.link ? (data.link as string).trim() : undefined,
    resourceType: data.resourceType ? (data.resourceType as string).trim() : undefined,
    resourceId: data.resourceId ? (data.resourceId as string).trim() : undefined,
    metadata: data.metadata as Record<string, unknown> | undefined,
    expiresAt: data.expiresAt as string | undefined,
  };
}

export function validateUpdateNotification(body: unknown): UpdateNotificationInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Request body is required');
  }

  const data = body as Record<string, unknown>;
  const updates: UpdateNotificationInput = {};

  if (data.read !== undefined) {
    if (typeof data.read !== 'boolean') {
      throw new ValidationError('read must be a boolean');
    }
    updates.read = data.read;
    
    // Auto-set readAt when marking as read
    if (data.read === true) {
      updates.readAt = new Date().toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    throw new ValidationError('At least one field must be provided for update');
  }

  return updates;
}

/**
 * Validate notification ID format (UUID)
 */
export function validateNotificationId(id: string): void {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    throw new ValidationError('Invalid notification ID format');
  }
}
