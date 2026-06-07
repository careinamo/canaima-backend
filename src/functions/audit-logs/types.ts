/**
 * Types for the Audit Logs system
 */

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE';

export type ResourceType = 'client' | 'credit-note' | 'payment' | 'organization';

export interface AuditLogEntry {
  orgId: string;
  sk: string; // timestamp#eventId for sorting
  eventId: string;
  userId: string;
  gsi1pk: string; // orgId#userId for GSI
  action: AuditAction;
  resourceType: ResourceType;
  resourceId: string;
  resourceName?: string;
  timestamp: string; // ISO 8601
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
  ttl?: number; // Unix timestamp for TTL (optional)
}

export interface CreateAuditLogInput {
  orgId: string;
  userId: string;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId: string;
  resourceName?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

export interface ListAuditLogsOptions {
  orgId: string;
  userId?: string; // Filter by specific user
  startDate?: string; // ISO 8601
  endDate?: string; // ISO 8601
  action?: AuditAction;
  resourceType?: ResourceType;
  resourceId?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedAuditLogs {
  items: AuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
