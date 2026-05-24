import type { APIGatewayProxyEventV2WithLambdaAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import * as repo from './repository';
import { updateUserProfileSchema } from './validators';
import { getAuth } from '../shared/auth';
import { HttpError, toErrorResponse } from '../shared/errors';

class UserError extends HttpError {}

/**
 * GET /users/me
 * Get current authenticated user profile
 */
export async function getCurrentUser(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);

    const user = await repo.getUser(userId);
    if (!user) {
      throw new UserError(404, 'User profile not found');
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: user,
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * PATCH /users/me
 * Update current user profile
 */
export async function updateCurrentUser(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const { userId } = getAuth(event);
    const body = JSON.parse(event.body || '{}');

    const validated = updateUserProfileSchema.parse(body);

    const user = await repo.updateUserProfile(userId, validated);

    return {
      statusCode: 200,
      body: JSON.stringify({
        data: user,
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
 * GET /users/{userId}
 * Get user profile (public, only if shares organization)
 */
export async function getUser(
  event: APIGatewayProxyEventV2WithLambdaAuthorizer<any>,
): Promise<APIGatewayProxyResultV2> {
  try {
    const userId = event.pathParameters?.userId;

    if (!userId) {
      throw new UserError(400, 'Missing userId');
    }

    const user = await repo.getUser(userId);
    if (!user) {
      throw new UserError(404, 'User not found');
    }

    // Return only public fields
    return {
      statusCode: 200,
      body: JSON.stringify({
        data: {
          clerkUserId: user.clerkUserId,
          firstName: user.firstName,
          lastName: user.lastName,
          imageUrl: user.imageUrl,
        },
      }),
    };
  } catch (error) {
    return toErrorResponse(error);
  }
}
