import type { APIGatewayProxyEventV2WithLambdaAuthorizer } from 'aws-lambda';
import { HttpError } from './errors';

export interface AuthContext {
  userId: string;
  orgId: string;
  orgRole: string;
  orgSlug?: string;
}

/**
 * Extract authentication context from Lambda authorizer
 */
export function getAuth(event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>): AuthContext {
  const auth = event.requestContext?.authorizer?.lambda;

  if (!auth?.userId) {
    throw new HttpError(401, 'Unauthorized: Missing user context');
  }

  return {
    userId: auth.userId,
    orgId: auth.orgId || '',
    orgRole: auth.orgRole || 'member',
    orgSlug: auth.orgSlug,
  };
}

/**
 * Require organization context (some endpoints need it)
 */
export function requireOrgContext(auth: AuthContext, requiredRole?: string): void {
  if (!auth.orgId) {
    throw new HttpError(403, 'Organization context required');
  }

  if (requiredRole && auth.orgRole !== requiredRole) {
    throw new HttpError(403, `Only ${requiredRole}s can perform this action`);
  }
}
