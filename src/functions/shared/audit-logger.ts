import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createAuditLog } from '../audit-logs/repository';
import type { AuditAction, ResourceType, CreateAuditLogInput } from '../audit-logs/types';
import { getUser } from '../users/repository';
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
 * logAuditEvent(event, 'CREATE', 'client', client.id, client.name, undefined, { email: client.email });
 * 
 * // After successful update with number:
 * logAuditEvent(event, 'UPDATE', 'credit-note', creditNote.id, undefined, creditNote.number, { amount: 1000 });
 * 
 * // After successful delete:
 * logAuditEvent(event, 'DELETE', 'payment', paymentId, undefined, payment.number);
 */
export function logAuditEvent(
  event: APIGatewayProxyEventV2,
  action: AuditAction,
  resourceType: ResourceType,
  resourceId: string,
  resourceName?: string,
  resourceNumber?: string,
  metadata?: Record<string, unknown>
): void {
  console.log('[AUDIT] logAuditEvent called:', { action, resourceType, resourceId, resourceName, resourceNumber });
  // Run async but don't await - fire and forget
  logAuditEventAsync(event, action, resourceType, resourceId, resourceName, resourceNumber, metadata)
    .catch(err => console.error('[AUDIT] Failed to log audit event:', err));
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
  resourceNumber?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  console.log('[AUDIT] logAuditEventAsync started');
  
  // Extract auth context
  const auth = getAuthOptional(event);
  console.log('[AUDIT] Auth context:', {
    hasAuth: !!auth,
    orgId: auth?.orgId,
    userId: auth?.userId,
  });
  
  if (!auth || !auth.orgId || !auth.userId) {
    console.warn('[AUDIT] Cannot log audit event: missing auth context', {
      hasAuth: !!auth,
      hasOrgId: !!auth?.orgId,
      hasUserId: !!auth?.userId,
    });
    return;
  }

  // Fetch user details for userName and userEmail
  let userName: string | undefined;
  let userEmail: string | undefined;
  try {
    const user = await getUser(auth.userId);
    if (user) {
      userName = [user.firstName, user.lastName].filter(Boolean).join(' ') || undefined;
      userEmail = user.email;
    }
  } catch (err) {
    console.warn('[AUDIT] Failed to fetch user details:', err);
    // Continue without user details
  }

  // Extract IP and User-Agent
  const ipAddress = event.requestContext?.http?.sourceIp || 
    event.headers?.['x-forwarded-for']?.split(',')[0]?.trim();
  const userAgent = event.headers?.['user-agent'];

  const input: CreateAuditLogInput = {
    orgId: auth.orgId,
    userId: auth.userId,
    userName,
    userEmail,
    action,
    resourceType,
    resourceId,
    resourceNumber,
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
  resourceNumber?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await logAuditEventAsync(event, action, resourceType, resourceId, resourceName, resourceNumber, metadata);
  } catch (err) {
    console.warn('Failed to log audit event (sync):', err);
  }
}
