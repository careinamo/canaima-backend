/**
 * Clerk Backend API Client
 * Used to update organizations and users in Clerk from our backend
 */

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
const CLERK_API_BASE = 'https://api.clerk.com/v1';

interface ClerkOrganization {
  id: string;
  name: string;
  slug: string;
  created_at: number;
  updated_at: number;
  public_metadata: Record<string, any>;
  private_metadata: Record<string, any>;
}

interface UpdateOrganizationInput {
  name?: string;
  slug?: string;
  public_metadata?: Record<string, any>;
  private_metadata?: Record<string, any>;
}

/**
 * Update organization in Clerk
 */
export async function updateClerkOrganization(
  organizationId: string,
  updates: UpdateOrganizationInput,
): Promise<ClerkOrganization> {
  if (!CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not configured');
  }

  const response = await fetch(`${CLERK_API_BASE}/organizations/${organizationId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(updates),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Clerk API error:', response.status, errorBody);
    throw new Error(`Clerk API error: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

/**
 * Get organization from Clerk
 */
export async function getClerkOrganization(organizationId: string): Promise<ClerkOrganization> {
  if (!CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY is not configured');
  }

  const response = await fetch(`${CLERK_API_BASE}/organizations/${organizationId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Clerk API error:', response.status, errorBody);
    throw new Error(`Clerk API error: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

/**
 * Check if Clerk API is configured
 */
export function isClerkApiConfigured(): boolean {
  return !!CLERK_SECRET_KEY;
}
