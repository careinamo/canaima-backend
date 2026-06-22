/**
 * Notification Types
 * 
 * Notifications are user-scoped (not org-scoped) since a user may belong
 * to multiple organizations and should see all their notifications in one place.
 */

export type NotificationType = 
  | 'credit_note_created'
  | 'credit_note_updated'
  | 'credit_note_deleted'
  | 'credit_note_expired'
  | 'credit_note_paid'
  | 'payment_created'
  | 'payment_updated'
  | 'payment_deleted'
  | 'client_created'
  | 'client_delinquent'
  | 'report_ready'
  | 'org_invite'
  | 'system';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Notification {
  id: string;
  userId: string;          // The user receiving this notification
  orgId?: string;          // Optional org context (for org-specific notifications)
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  message: string;
  read: boolean;
  link?: string;           // Deep link to related resource (e.g., /payments/123)
  resourceType?: string;   // e.g., 'credit-note', 'payment', 'client'
  resourceId?: string;     // ID of the related resource
  metadata?: Record<string, unknown>; // Additional context data
  createdAt: string;       // ISO 8601 timestamp
  readAt?: string;         // ISO 8601 timestamp when marked as read
  expiresAt?: string;      // ISO 8601 timestamp for auto-deletion (optional)
}

/** Internal DynamoDB record — includes PK/SK */
export interface NotificationRecord extends Notification {
  PK: string;              // user#<userId>
  SK: string;              // notification#<createdAt>#<id>
  GSI1PK?: string;         // For queries by orgId: org#<orgId>
  GSI1SK?: string;         // notification#<createdAt>#<id>
  ttl?: number;            // Unix timestamp for DynamoDB TTL
}

export interface CreateNotificationInput {
  userId: string;
  orgId?: string;
  type: NotificationType;
  priority?: NotificationPriority;
  title: string;
  message: string;
  link?: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  expiresAt?: string;
}

export interface UpdateNotificationInput {
  read?: boolean;
  readAt?: string;
}

export interface ListNotificationsParams {
  userId: string;
  orgId?: string;          // Optional: filter by organization
  unreadOnly?: boolean;
  page: number;
  limit: number;
  sortOrder: 'asc' | 'desc';
}

export interface ListNotificationsResult {
  items: Notification[];
  total: number;
  unreadCount: number;
}

/**
 * WebSocket Connection Types
 */
export interface WebSocketConnection {
  connectionId: string;
  userId: string;
  connectedAt: string;
  lastPingAt?: string;
  userAgent?: string;
  sourceIp?: string;
  ttl: number;             // Unix timestamp for connection expiry
}

export interface WebSocketConnectionRecord extends WebSocketConnection {
  PK: string;              // connection#<connectionId>
  SK: string;              // connection#<connectionId>
  GSI1PK: string;          // user#<userId>
  GSI1SK: string;          // connection#<connectedAt>#<connectionId>
}

/**
 * WebSocket Message Types (Server to Client)
 */
export type WebSocketEventType = 
  | 'connection_ack'
  | 'notification'
  | 'notification_deleted'
  | 'notification_read'
  | 'notifications_read_all'
  | 'heartbeat'
  | 'error'
  | 'credit_note_update'
  | 'payment_update'
  | 'report_ready'
  | 'org_update';

export interface WebSocketMessage<T = unknown> {
  type: WebSocketEventType;
  payload: T;
  timestamp: string;
}

export interface ConnectionAckPayload {
  connectionId: string;
  userId: string;
  serverTime: string;
  heartbeatIntervalMs: number;
}

export interface NotificationPayload extends Notification {}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * WebSocket Message Types (Client to Server)
 */
export type WebSocketActionType = 
  | 'markRead'
  | 'markAllRead'
  | 'heartbeat'
  | 'subscribe'
  | 'unsubscribe';

export interface WebSocketClientMessage {
  action: WebSocketActionType;
  notificationId?: string;
  orgId?: string;
}
