import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createAuditLog } from '../audit-logs/repository';
import type { AuditAction, ResourceType, CreateAuditLogInput } from '../audit-logs/types';
import { getAuthOptional } from './auth';

/**
 * Helper function to log an audit event.
 * This should be called after a successful CREATE, UPDATE, or DELETE operation.
 * 
 * The function is async but should be called without await to not block the response.
 * It catches its own errors to prevent audit logging failures from affecting the main operation.
 * 
 * @example
 * // After successful create:
 * logAuditEvent(event, 'CREATE', 'client', client.id, client.name, { email: client.email });
 * 
 * // After successful update:
 * logAuditEvent(event, 'UPDATE', 'credit-note', creditNote.id, undefined, { amount: 1000 });
 * 
 * // After successful delete:
 * logAuditEvent(event, 'DELETE', 'payment', paymentId);
 */
export function logAuditEvent(
  event: APIGatewayProxyEventV2,
  action: AuditAction,
  resourceType: ResourceType,
  resourceId: string,
  resourceName?: string,
  metadata?: Record<string, unknown>
): void {
  // Run async but don't await - fire and forget
  logAuditEventAsync(event, action, resourceType, resourceId, resourceName, metadata)
    .catch(err => console.warn('Failed to log audit event:', err));
}

/**
 * Internal async implementation
 */
async function logAuditEventAsync(
  event: APIGatewayProxyEventV2,
  action: AuditAction,
  resourceType: ResourceType,
  resourceId: string,
  resourceName?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  // Extract auth context
  const auth = getAuthOptional(event);
  
  if (!auth || !auth.orgId || !auth.userId) {
    console.warn('Cannot log audit event: missing auth context', {
      hasAuth: !!auth,
      hasOrgId: !!auth?.orgId,
      hasUserId: !!auth?.userId,
    });
    return;
  }

  // Extract IP and User-Agent
  const ipAddress = event.requestContext?.http?.sourceIp || 
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
  const userAgent = event.headers?.['user-agent'];

  const input: CreateAuditLogInput = {
    orgId: auth.orgId,
    userId: auth.userId,
    action,
    resourceType,
    resourceId,
    resourceName,
    ipAddress,
    userAgent,
    metadata,
  };

  await createAuditLog(input);
  
  console.log('Audit event logged:', {
    action,
    resourceType,
    resourceId,
    userId: auth.userId,
    orgId: auth.orgId,
  });
}

/**
 * Awaitable version of logAuditEvent for cases where you need to ensure
 * the audit log is written before responding (e.g., delete operations).
 */
export async function logAuditEventSync(
  event: APIGatewayProxyEventV2,
  action: AuditAction,
  resourceType: ResourceType,
  resourceId: string,
  resourceName?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await logAuditEventAsync(event, action, resourceType, resourceId, resourceName, metadata);
  } catch (err) {
    console.warn('Failed to log audit event (sync):', err);
  }
}
