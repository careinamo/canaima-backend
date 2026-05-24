import { jwtVerify, createRemoteJWKSet } from 'jose';
import type { APIGatewayProxyEventV2, APIGatewaySimpleAuthorizerResult } from 'aws-lambda';

const JWKS_URL = process.env.CLERK_JWKS_URL;
const ISSUER = process.env.CLERK_ISSUER;

// Cache JWKS in memory
let jwksCached: any = null;
let jwksCacheTime = 0;

async function getJWKS() {
  const now = Date.now();
  const cacheTTL = parseInt(process.env.JWKS_CACHE_TTL || '3600000'); // 1 hour default

  if (!jwksCached || now - jwksCacheTime > cacheTTL) {
    try {
      const response = await fetch(JWKS_URL!);
      jwksCached = await response.json();
      jwksCacheTime = now;
    } catch (error) {
      console.error('Failed to fetch JWKS:', error);
      throw new Error('Failed to fetch JWKS');
    }
  }

  return jwksCached;
}

/**
 * Lambda Authorizer for Clerk JWT tokens
 * Returns simple authorization response with context
 */
export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewaySimpleAuthorizerResult> {
  try {
    const token = event.headers.authorization?.split(' ')[1];

    if (!token) {
      return {
        isAuthorized: false,
      };
    }

    // Get JWKS
    const jwks = await getJWKS();
    const keyset = createRemoteJWKSet(new URL(JWKS_URL!), {
      cacheMaxAge: parseInt(process.env.JWKS_CACHE_TTL || '3600000'),
    });

    // Verify JWT
    const { payload } = await jwtVerify(token, keyset, {
      issuer: ISSUER,
      audience: undefined, // Clerk doesn't always include audience
    });

    // Extract claims
    const userId = (payload.sub as string) || '';
    const orgId = (payload.org_id as string) || '';
    const orgRole = (payload.org_role as string) || 'member';
    const orgSlug = (payload.org_slug as string) || '';

    if (!userId) {
      return {
        isAuthorized: false,
      };
    }

    return {
      isAuthorized: true,
      context: {
        userId,
        orgId,
        orgRole,
        orgSlug,
      },
    };
  } catch (error) {
    console.error('Authorizer error:', error);
    return {
      isAuthorized: false,
    };
  }
}
