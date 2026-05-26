import { getCurrentTimestampInTimezone } from '../shared/timezone-utils';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { Organization, OrganizationMember, ListOrgsByUserResult } from './types';

const TABLE = process.env.TABLE_ORGANIZATIONS as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export async function upsertOrg(input: {
  clerkOrgId: string;
  name: string;
  teamSize?: number;
  currency?: string;
  createdBy: string;
}): Promise<Organization> {
  const now = getCurrentTimestampInTimezone();
  const pk = `ORG#${input.clerkOrgId}`;

  const org: Organization = {
    PK: pk,
    SK: 'META',
    clerkOrgId: input.clerkOrgId,
    name: input.name,
    slug: input.name.toLowerCase().replace(/\s+/g, '-'),
    teamSize: input.teamSize,
    plan: 'free',
    currency: input.currency || 'USD',
    createdBy: input.createdBy,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: org,
    }),
  );

  return org;
}

export async function getOrg(clerkOrgId: string): Promise<Organization | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE,
      Key: {
        PK: `ORG#${clerkOrgId}`,
        SK: 'META',
      },
    }),
  );

  return result.Item as Organization || null;
}

export async function updateOrg(
  clerkOrgId: string,
  updates: {
    name?: string;
    teamSize?: number;
    currency?: string;
    settings?: Record<string, any>;
    plan?: string;
  },
): Promise<Organization> {
  const now = getCurrentTimestampInTimezone();
  const pk = `ORG#${clerkOrgId}`;

  const updateExpressionParts: string[] = [];
  const expressionAttributeValues: Record<string, any> = {
    ':updatedAt': now,
  };

  if (updates.name !== undefined) {
    updateExpressionParts.push('#name = :name');
    expressionAttributeValues[':name'] = updates.name;
  }
  if (updates.teamSize !== undefined) {
    updateExpressionParts.push('teamSize = :teamSize');
    expressionAttributeValues[':teamSize'] = updates.teamSize;
  }
  if (updates.currency !== undefined) {
    updateExpressionParts.push('currency = :currency');
    expressionAttributeValues[':currency'] = updates.currency;
  }
  if (updates.settings !== undefined) {
    updateExpressionParts.push('settings = :settings');
    expressionAttributeValues[':settings'] = updates.settings;
  }
  if (updates.plan !== undefined) {
    updateExpressionParts.push('plan = :plan');
    expressionAttributeValues[':plan'] = updates.plan;
  }

  updateExpressionParts.push('updatedAt = :updatedAt');

  const updateExpression = `SET ${updateExpressionParts.join(', ')}`;

  const result = await ddb.send(
    new UpdateCommand({
      TableName: TABLE,
      Key: {
        PK: pk,
        SK: 'META',
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  return result.Attributes as Organization;
}

export async function listMembers(clerkOrgId: string): Promise<OrganizationMember[]> {
  const pk = `ORG#${clerkOrgId}`;

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
      ExpressionAttributeValues: {
        ':pk': pk,
        ':skPrefix': 'USER#',
      },
    }),
  );

  return (result.Items || []) as OrganizationMember[];
}

export async function addMember(input: {
  clerkOrgId: string;
  userId: string;
  role: string;
  invitedBy?: string;
  status?: string;
}): Promise<OrganizationMember> {
  const now = getCurrentTimestampInTimezone();
  const pk = `ORG#${input.clerkOrgId}`;
  const sk = `USER#${input.userId}`;

  const member: OrganizationMember = {
    PK: pk,
    SK: sk,
    userId: input.userId,
    role: input.role as 'admin' | 'member',
    joinedAt: now,
    invitedBy: input.invitedBy,
    status: (input.status || 'active') as 'active' | 'invited',
  };

  // Also add GSI1 entry for querying orgs by user
  const gsi1Item = {
    PK: pk,
    SK: sk,
    GSI1PK: `USER#${input.userId}`,
    GSI1SK: pk,
    ...member,
  };

  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: gsi1Item,
    }),
  );

  return member;
}

export async function removeMember(clerkOrgId: string, userId: string): Promise<void> {
  const pk = `ORG#${clerkOrgId}`;
  const sk = `USER#${userId}`;

  await ddb.send(
    new DeleteCommand({
      TableName: TABLE,
      Key: { PK: pk, SK: sk },
    }),
  );
}

export async function listOrgsByUser(userId: string): Promise<ListOrgsByUserResult[]> {
  const gsi1pk = `USER#${userId}`;

  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :gsi1pk',
      ExpressionAttributeValues: {
        ':gsi1pk': gsi1pk,
      },
    }),
  );

  return (result.Items || []).map((item: any) => ({
    orgId: item.clerkOrgId || item.GSI1SK.replace('ORG#', ''),
    name: item.name || item.orgName,
    role: item.role,
    joinedAt: item.joinedAt,
  }));
}

export async function deleteOrganizationAndMembers(clerkOrgId: string): Promise<void> {
  const pk = `ORG#${clerkOrgId}`;

  // First, get all items under this org
  const result = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk',
      ExpressionAttributeValues: {
        ':pk': pk,
      },
    }),
  );

  // Delete all items
  const items = result.Items || [];
  for (const item of items) {
    await ddb.send(
      new DeleteCommand({
        TableName: TABLE,
        Key: {
          PK: item.PK,
          SK: item.SK,
        },
      }),
    );
  }
}
