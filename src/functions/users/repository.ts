import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { User, UpdateUserProfileInput } from './types';

const TABLE = process.env.TABLE_USERS as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function upsertUser(input: {
  clerkUserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
}): Promise<User> {
  const now = new Date().toISOString();
  const pk = `USER#${input.clerkUserId}`;

  const user: User = {
    PK: pk,
    SK: 'PROFILE',
    clerkUserId: input.clerkUserId,
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    imageUrl: input.imageUrl,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: user,
    }),
  );

  return user;
}

export async function getUser(clerkUserId: string): Promise<User | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: {
        PK: `USER#${clerkUserId}`,
        SK: 'PROFILE',
      },
    }),
  );

  return result.Item as User || null;
}

export async function updateUserProfile(
  clerkUserId: string,
  updates: UpdateUserProfileInput,
): Promise<User> {
  const now = new Date().toISOString();
  const pk = `USER#${clerkUserId}`;

  const updateExpressionParts: string[] = [];
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  if (updates.firstName !== undefined) {
    updateExpressionParts.push('firstName = :firstName');
    expressionAttributeValues[':firstName'] = updates.firstName;
  }
  if (updates.lastName !== undefined) {
    updateExpressionParts.push('lastName = :lastName');
    expressionAttributeValues[':lastName'] = updates.lastName;
  }
  if (updates.imageUrl !== undefined) {
    updateExpressionParts.push('imageUrl = :imageUrl');
    expressionAttributeValues[':imageUrl'] = updates.imageUrl;
  }

  updateExpressionParts.push('updatedAt = :updatedAt');

  const updateExpression = `SET ${updateExpressionParts.join(', ')}`;

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: pk,
        SK: 'PROFILE',
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return result.Attributes as User;
}

export async function deleteUser(clerkUserId: string): Promise<void> {
  // Soft delete: just update updatedAt, or hard delete via DeleteCommand
  // For now, we'll do a soft approach by marking as deleted
  const now = new Date().toISOString();
  const pk = `USER#${clerkUserId}`;

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: pk,
        SK: 'PROFILE',
      },
      UpdateExpression: 'SET deletedAt = :deletedAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':deletedAt': now,
        ':updatedAt': now,
      },
    }),
  );
}

export async function recordLastSignIn(clerkUserId: string): Promise<void> {
  const now = new Date().toISOString();
  const pk = `USER#${clerkUserId}`;

  await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: pk,
        SK: 'PROFILE',
      },
      UpdateExpression: 'SET lastSignInAt = :lastSignInAt, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':lastSignInAt': now,
        ':updatedAt': now,
      },
    }),
  );
}
