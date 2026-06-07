import { APIGatewayProxyEventV2 } from 'aws-lambda';

export interface AuthContext {
  userId: string;
  orgId: string | null;
  orgRole: string | null;
  orgSlug: string | null;
}

/**
 * Extract authentication context from the request.
 * This context is injected by the Clerk JWT Authorizer.
 * 
 * @param event - API Gateway event
 * @returns AuthContext with user and organization info
 * @throws Error if auth context is missing (should not happen with authorizer)
 */
export function getAuth(event: APIGatewayProxyEventV2): AuthContext {
  const authorizer = (event.requestContext as any)?.authorizer?.lambda;
  
  if (!authorizer) {
    throw new Error('Missing authorizer context - ensure endpoint is protected');
  }
  
  return {
    userId: authorizer.userId || '',
    orgId: authorizer.orgId || null,
    orgRole: authorizer.orgRole || null,
    orgSlug: authorizer.orgSlug || null,
  };
}

/**
 * Safely try to get auth context, returns null if not available.
 * Useful for endpoints that support both authenticated and unauthenticated access.
 * 
 * @param event - API Gateway event
 * @returns AuthContext or null if not authenticated
 */
export function getAuthOptional(event: APIGatewayProxyEventV2): AuthContext | null {
  try {
    const auth = getAuth(event);
    return auth.userId ? auth : null;
  } catch {
    return null;
  }
}

/**
 * Check if the user has access to a specific organization.
 * Compares the orgId from the URL with the orgId from the JWT.
 * 
 * @param event - API Gateway event
 * @param requestedOrgId - The orgId from the URL path
 * @returns true if user has access, false otherwise
 */
export function hasOrgAccess(event: APIGatewayProxyEventV2, requestedOrgId: string): boolean {
  const auth = getAuthOptional(event);
  
  if (!auth || !auth.orgId) {
    return false;
  }
  
  return auth.orgId === requestedOrgId;
}

/**
 * Get the authenticated user's ID.
 * Shorthand for getAuth(event).userId
 * 
 * @param event - API Gateway event
 * @returns User ID from Clerk
 */
export function getUserId(event: APIGatewayProxyEventV2): string {
  return getAuth(event).userId;
}

/**
 * Get the active organization ID from the JWT.
 * Returns null if user has no active organization.
 * 
 * @param event - API Gateway event
 * @returns Organization ID or null
 */
export function getOrgId(event: APIGatewayProxyEventV2): string | null {
  return getAuth(event).orgId;
}
