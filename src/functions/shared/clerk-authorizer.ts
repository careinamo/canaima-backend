import { APIGatewayRequestAuthorizerEventV2, APIGatewaySimpleAuthorizerWithContextResult } from 'aws-lambda';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';

// Cache JWKS for 1 hour to avoid fetching on every request
let jwksCache: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// Check if running in local/offline mode
const isOffline = process.env.IS_OFFLINE === 'true' || process.env.IS_LOCAL === 'true';

interface ClerkJWTPayload extends JWTPayload {
  sub: string;           // Clerk User ID
  azp?: string;          // Authorized party (your frontend URL)
  org_id?: string;       // Organization ID (if user has active org)
  org_role?: string;     // Role in organization (admin, member)
  org_slug?: string;     // Organization slug
  org_permissions?: string[]; // Organization permissions
}

export interface AuthContext {
  userId: string;
  orgId: string | null;
  orgRole: string | null;
  orgSlug: string | null;
}

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  const now = Date.now();
  
  if (jwksCache && (now - jwksCacheTime) < JWKS_CACHE_TTL) {
    return jwksCache;
  }
  
  const jwksUrl = process.env.CLERK_JWKS_URL;
  if (!jwksUrl) {
    throw new Error('CLERK_JWKS_URL environment variable is not set');
  }
  
  jwksCache = createRemoteJWKSet(new URL(jwksUrl));
  jwksCacheTime = now;
  
  return jwksCache;
}

/**
 * Handle local development bypass.
 * In offline mode, you can use these headers instead of a real JWT:
 * - X-Dev-User-Id: user ID to simulate
 * - X-Dev-Org-Id: organization ID to simulate  
 * - X-Dev-Org-Role: role to simulate (admin, member)
 */
function handleLocalBypass(event: APIGatewayRequestAuthorizerEventV2): APIGatewaySimpleAuthorizerWithContextResult<AuthContext> | null {
  if (!isOffline) {
    return null;
  }

  const devUserId = event.headers?.['x-dev-user-id'];
  const devOrgId = event.headers?.['x-dev-org-id'];
  const devOrgRole = event.headers?.['x-dev-org-role'];

  // If no auth header and no dev headers, use default dev user
  const authHeader = event.headers?.authorization || event.headers?.Authorization;
  
  if (!authHeader && !devUserId) {
    console.log('[DEV MODE] No auth - using default dev user');
    return {
      isAuthorized: true,
      context: {
        userId: 'dev_user_local',
        orgId: 'org-default',
        orgRole: 'admin',
        orgSlug: null,
      },
    };
  }

  // If dev headers are provided, use them
  if (devUserId) {
    console.log('[DEV MODE] Using dev headers - userId:', devUserId, 'orgId:', devOrgId);
    return {
      isAuthorized: true,
      context: {
        userId: devUserId,
        orgId: devOrgId || null,
        orgRole: devOrgRole || null,
        orgSlug: null,
      },
    };
  }

  // Has auth header, continue with normal validation
  return null;
}

export const handler = async (
  event: APIGatewayRequestAuthorizerEventV2
): Promise<APIGatewaySimpleAuthorizerWithContextResult<AuthContext>> => {
  console.log('Authorizer invoked for:', event.routeKey);
  
  // Check for local development bypass
  const localBypass = handleLocalBypass(event);
  if (localBypass) {
    return localBypass;
  }

  try {
    // Extract token from Authorization header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    
    if (!authHeader) {
      console.log('No Authorization header');
      return buildDenyResponse('Missing Authorization header');
    }
    
    // Support both "Bearer <token>" and raw token
    const token = authHeader.startsWith('Bearer ') 
      ? authHeader.slice(7) 
      : authHeader;
    
    if (!token) {
      console.log('Empty token');
      return buildDenyResponse('Empty token');
    }
    
    // Verify JWT
    const issuer = process.env.CLERK_ISSUER;
    if (!issuer) {
      throw new Error('CLERK_ISSUER environment variable is not set');
    }
    
    const jwks = getJWKS();
    
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      // Clerk tokens have short expiration, no need for clockTolerance
    });
    
    const clerkPayload = payload as ClerkJWTPayload;
    
    console.log('JWT verified successfully for user:', clerkPayload.sub);
    
    // Build auth context
    const context: AuthContext = {
      userId: clerkPayload.sub,
      orgId: clerkPayload.org_id || null,
      orgRole: clerkPayload.org_role || null,
      orgSlug: clerkPayload.org_slug || null,
    };
    
    return {
      isAuthorized: true,
      context,
    };
    
  } catch (error) {
    console.error('Authorization failed:', error);
    
    if (error instanceof Error) {
      // Common JWT errors
      if (error.message.includes('expired')) {
        return buildDenyResponse('Token expired');
      }
      if (error.message.includes('signature')) {
        return buildDenyResponse('Invalid signature');
      }
    }
    
    return buildDenyResponse('Unauthorized');
  }
};

function buildDenyResponse(reason: string): APIGatewaySimpleAuthorizerWithContextResult<AuthContext> {
  console.log('Denying access:', reason);
  return {
    isAuthorized: false,
    context: {
      userId: '',
      orgId: null,
      orgRole: null,
      orgSlug: null,
    },
  };
}
