import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import * as repo from './repository';
import { createOrganizationSchema, updateOrganizationSchema } from './validators';
import { HttpError, toErrorResponse } from '../shared/errors';
import { updateClerkOrganization, isClerkApiConfigured } from '../shared/clerk-api';
import { requireOrgAccess } from '../shared/auth';
import { logAuditEventSync } from '../shared/audit-logger';

class OrganizationError extends HttpError {}

/**
 * GET /users/me/organizations
 * List all organizations (public endpoint)
 */
export async function listUserOrganizations(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    // For now, return empty list or all orgs
    // TODO: When auth is re-enabled, extract userId from JWT
    const userId = event.queryStringParameters?.userId || '';
    const orgs = userId ? await repo.listOrgsByUser(userId) : [];

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: orgs,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * GET /organizations/{orgId}
 * Get organization metadata (public endpoint)
 */
export async function getOrganization(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, clerkOrgId);
    if (accessDenied) return accessDenied;

    const org = await repo.getOrg(clerkOrgId);
    if (!org) {
      throw new OrganizationError(404, 'Organization not found');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: org,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * POST /organizations
 * Create or upsert organization (public endpoint)
 */
export async function createOrganization(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const body = JSON.parse(event.body || '{}');

    const validated = createOrganizationSchema.parse(body);

    const org = await repo.upsertOrg({
      clerkOrgId: validated.clerkOrgId,
      name: validated.name,
      teamSize: validated.teamSize,
      currency: validated.currency,
      createdBy: 'anonymous',
    });

    // Log audit event
    await logAuditEventSync(event, 'CREATE', 'organization', org.clerkOrgId, org.name, undefined, {
      teamSize: org.teamSize,
      currency: org.currency,
    });

    return {
      statusCode: 201,
      body: JSON.stringify({
        data: org,
      }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation error', details: error.errors }),
      };
    }
    return toErrorResponse(error);
  }
}

/**
 * PATCH /organizations/{orgId}
 * Update organization (public endpoint - TODO: add auth when re-enabled)
 */
export async function updateOrganization(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, clerkOrgId);
    if (accessDenied) return accessDenied;

    const body = JSON.parse(event.body || '{}');
    const validated = updateOrganizationSchema.parse(body);

    const org = await repo.updateOrg(clerkOrgId, validated);

    // Log audit event
    await logAuditEventSync(event, 'UPDATE', 'organization', clerkOrgId, org?.name, undefined, {
      updatedFields: Object.keys(validated),
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: org,
      }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation error', details: error.errors }),
      };
    }
    return toErrorResponse(error);
  }
}

/**
 * GET /organizations/{orgId}/members
 * List all members of an organization (public endpoint)
 */
export async function listOrganizationMembers(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, clerkOrgId);
    if (accessDenied) return accessDenied;

    const members = await repo.listMembers(clerkOrgId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: members,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Schema for onboarding completion
const completeOnboardingSchema = z.object({
  name: z.string().min(1, 'Organization name is required'),
  teamSize: z.number().int().min(1, 'Team size must be at least 1'),
});

/**
 * POST /organizations/{orgId}/complete-onboarding
 * Complete organization onboarding: update name, teamSize, and sync to Clerk
 */
export async function completeOnboarding(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, clerkOrgId);
    if (accessDenied) return accessDenied;

    // Verify organization exists
    const existingOrg = await repo.getOrg(clerkOrgId);
    if (!existingOrg) {
      throw new OrganizationError(404, 'Organization not found');
    }

    // Check if already completed
    if (existingOrg.onboardingCompleted) {
      return {
        statusCode: 200,
        body: JSON.stringify({
          data: existingOrg,
          message: 'Onboarding already completed',
        }),
      };
    }

    const body = JSON.parse(event.body || '{}');
    const validated = completeOnboardingSchema.parse(body);

    // Update Clerk organization name
    if (isClerkApiConfigured()) {
      try {
        await updateClerkOrganization(clerkOrgId, {
          name: validated.name,
          slug: validated.name.toLowerCase().replace(/\s+/g, '-'),
        });
        console.log(`Updated Clerk organization ${clerkOrgId} name to "${validated.name}"`);
      } catch (clerkError) {
        console.error('Failed to update Clerk organization:', clerkError);
        // Continue with DynamoDB update even if Clerk fails
        // This ensures we don't leave the user stuck
      }
    } else {
      console.warn('CLERK_SECRET_KEY not configured, skipping Clerk API update');
    }

    // Complete onboarding in DynamoDB
    const org = await repo.completeOnboarding(clerkOrgId, {
      name: validated.name,
      teamSize: validated.teamSize,
    });

    // Log audit event
    await logAuditEventSync(event, 'UPDATE', 'organization', clerkOrgId, validated.name, undefined, {
      action: 'complete-onboarding',
      teamSize: validated.teamSize,
    });

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: org,
        message: 'Onboarding completed successfully',
      }),
    };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Validation error', details: error.errors }),
      };
    }
    return toErrorResponse(error);
  }
}
