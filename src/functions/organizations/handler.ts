import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import * as repo from './repository';
import { createOrganizationSchema, updateOrganizationSchema } from './validators';
import { getAuth } from '../shared/auth';
import { HttpError, toErrorResponse } from '../shared/errors';

class OrganizationError extends HttpError {}

/**
 * GET /users/me/organizations
 * List all organizations for the authenticated user
 */
export async function listUserOrganizations(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);

    const orgs = await repo.listOrgsByUser(userId);

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
 * Get organization metadata and members
 */
export async function getOrganization(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Verify user belongs to this org
    const members = await repo.listMembers(clerkOrgId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new OrganizationError(403, 'Not a member of this organization');
    }

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
 * Create or upsert organization (called after Clerk createOrganization)
 */
export async function createOrganization(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);
    const body = JSON.parse(event.body || '{}');

    const validated = createOrganizationSchema.parse(body);

    const org = await repo.upsertOrg({
      clerkOrgId: validated.clerkOrgId,
      name: validated.name,
      teamSize: validated.teamSize,
      currency: validated.currency,
      createdBy: userId,
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
 * Update organization (admin only)
 */
export async function updateOrganization(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Verify user is admin
    const members = await repo.listMembers(clerkOrgId);
    const userMembership = members.find((m) => m.userId === userId);
    if (!userMembership) {
      throw new OrganizationError(403, 'Not a member of this organization');
    }
    if (userMembership.role !== 'admin') {
      throw new OrganizationError(403, 'Only admins can update organization');
    }

    const body = JSON.parse(event.body || '{}');
    const validated = updateOrganizationSchema.parse(body);

    const org = await repo.updateOrg(clerkOrgId, validated);

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
 * List all members of an organization
 */
export async function listOrganizationMembers(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);
    const clerkOrgId = event.pathParameters?.orgId;

    if (!clerkOrgId) {
      throw new OrganizationError(400, 'Missing orgId');
    }

    // Verify user belongs to this org
    const members = await repo.listMembers(clerkOrgId);
    const isMember = members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new OrganizationError(403, 'Not a member of this organization');
    }

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

import { z } from 'zod';
