import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as repo from './repository';
import type { AuditAction, ResourceType } from './types';
import { requireOrgAccess } from '../shared/auth';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  },
  body: JSON.stringify(body),
});

const clientError = (statusCode: number, message: string) =>
  respond(statusCode, { error: message });

const serverError = () => respond(500, { error: 'Internal server error' });

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/audit-logs
// ---------------------------------------------------------------------------

/**
 * List audit logs for an organization
 * 
 * Query params:
 * - userId: Filter by specific user
 * - startDate: ISO 8601 date (e.g., 2026-06-01)
 * - endDate: ISO 8601 date (e.g., 2026-06-07)
 * - action: CREATE | UPDATE | DELETE
 * - resourceType: client | credit-note | payment | organization
 * - resourceId: Filter by specific resource ID
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 50, max: 100)
 * - sortOrder: asc | desc (default: desc)
 */
export const listAuditLogs = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    if (!orgId) return clientError(400, 'Missing orgId');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const q = event.queryStringParameters ?? {};

    // Parse pagination
    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
    const sortOrder: 'asc' | 'desc' = q.sortOrder === 'asc' ? 'asc' : 'desc';

    // Validate action if provided
    const validActions: AuditAction[] = ['CREATE', 'UPDATE', 'DELETE'];
    if (q.action && !validActions.includes(q.action as AuditAction)) {
      return clientError(400, `action must be one of: ${validActions.join(', ')}`);
    }

    // Validate resourceType if provided
    const validResourceTypes: ResourceType[] = ['client', 'credit-note', 'payment', 'organization'];
    if (q.resourceType && !validResourceTypes.includes(q.resourceType as ResourceType)) {
      return clientError(400, `resourceType must be one of: ${validResourceTypes.join(', ')}`);
    }

    // Parse dates - add time component for range queries
    let startDate = q.startDate;
    let endDate = q.endDate;
    
    // If only date provided (YYYY-MM-DD), add time for proper range
    if (startDate && startDate.length === 10) {
      startDate = `${startDate}T00:00:00.000Z`;
    }
    if (endDate && endDate.length === 10) {
      endDate = `${endDate}T23:59:59.999Z`;
    }

    const result = await repo.listAuditLogs({
      orgId,
      userId: q.userId,
      startDate,
      endDate,
      action: q.action as AuditAction | undefined,
      resourceType: q.resourceType as ResourceType | undefined,
      resourceId: q.resourceId,
      page,
      limit,
      sortOrder,
    });

    return respond(200, {
      data: result.items,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalPages: Math.ceil(result.total / result.limit) || 1,
        totalCount: result.total,
        hasMore: result.hasMore,
      },
    });
  } catch (error) {
    console.error('listAuditLogs error:', error);
    return serverError();
  }
};
