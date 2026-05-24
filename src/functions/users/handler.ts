import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import * as repo from './repository';
import { updateUserProfileSchema } from './validators';
import { HttpError, toErrorResponse } from '../shared/errors';

class UserError extends HttpError {}

/**
 * GET /users/me
 * Get user profile (accepts userId as query parameter)
 */
export async function getCurrentUser(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const userId = event.queryStringParameters?.userId;

    if (!userId) {
      throw new UserError(400, 'Missing userId parameter');
    }

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
 * Update user profile (accepts userId as query parameter)
 */
export async function updateCurrentUser(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const userId = event.queryStringParameters?.userId;

    if (!userId) {
      throw new UserError(400, 'Missing userId parameter');
    }

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
 * Get user profile (public endpoint)
 */
export async function getUser(
  event: APIGatewayProxyEventV2,
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
