import { randomUUID } from 'node:crypto';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type {
  AuditLogEntry,
  CreateAuditLogInput,
  ListAuditLogsOptions,
  PaginatedAuditLogs,
} from './types';

const TABLE = process.env.TABLE_AUDIT_LOGS as string;
const BY_USER_INDEX = 'byUser';

console.log('[AUDIT-REPO] TABLE_AUDIT_LOGS:', TABLE);

// TTL: 90 days by default (can be adjusted)
const DEFAULT_TTL_DAYS = 90;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

/**
 * Create a new audit log entry
 */
export async function createAuditLog(input: CreateAuditLogInput): Promise<AuditLogEntry> {
  console.log('[AUDIT-REPO] createAuditLog called with:', JSON.stringify(input));
  console.log('[AUDIT-REPO] Using table:', TABLE);
  
  const timestamp = new Date().toISOString();
  const eventId = `evt_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const sk = `${timestamp}#${eventId}`;
  const gsi1pk = `${input.orgId}#${input.userId}`;
  
  // Calculate TTL (90 days from now)
  const ttl = Math.floor(Date.now() / 1000) + (DEFAULT_TTL_DAYS * 24 * 60 * 60);

  const entry: AuditLogEntry = {
    orgId: input.orgId,
    sk,
    eventId,
    userId: input.userId,
    gsi1pk,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    resourceName: input.resourceName,
    timestamp,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: input.metadata,
    ttl,
  };

  console.log('[AUDIT-REPO] Saving entry to DynamoDB:', JSON.stringify(entry));
  
  await ddb.send(
    new PutCommand({
      TableName: TABLE,
      Item: entry,
    })
  );
  
  console.log('[AUDIT-REPO] Entry saved successfully');

  return entry;
}

/**
 * List audit logs for an organization with optional filters
 */
export async function listAuditLogs(
  options: ListAuditLogsOptions
): Promise<PaginatedAuditLogs> {
  const {
    orgId,
    userId,
    startDate,
    endDate,
    action,
    resourceType,
    resourceId,
    page = 1,
    limit = 50,
    sortOrder = 'desc',
  } = options;

  // Decide which index to use
  const useUserIndex = !!userId;
  const indexName = useUserIndex ? BY_USER_INDEX : undefined;
  const pkName = useUserIndex ? 'gsi1pk' : 'orgId';
  const pkValue = useUserIndex ? `${orgId}#${userId}` : orgId;

  // Build key condition
  let keyConditionExpression = `${pkName} = :pk`;
  const expressionAttributeValues: Record<string, unknown> = {
    ':pk': pkValue,
  };

  // Add date range if provided
  if (startDate && endDate) {
    keyConditionExpression += ' AND sk BETWEEN :start AND :end';
    expressionAttributeValues[':start'] = startDate;
    expressionAttributeValues[':end'] = `${endDate}~`; // ~ is after Z in ASCII
  } else if (startDate) {
    keyConditionExpression += ' AND sk >= :start';
    expressionAttributeValues[':start'] = startDate;
  } else if (endDate) {
    keyConditionExpression += ' AND sk <= :end';
    expressionAttributeValues[':end'] = `${endDate}~`;
  }

  // Build filter expression for additional filters
  const filterParts: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};

  if (action) {
    filterParts.push('#action = :action');
    expressionAttributeNames['#action'] = 'action';
    expressionAttributeValues[':action'] = action;
  }

  if (resourceType) {
    filterParts.push('resourceType = :resourceType');
    expressionAttributeValues[':resourceType'] = resourceType;
  }

  if (resourceId) {
    filterParts.push('resourceId = :resourceId');
    expressionAttributeValues[':resourceId'] = resourceId;
  }

  const filterExpression = filterParts.length > 0 ? filterParts.join(' AND ') : undefined;

  // First, get total count (without pagination)
  // For simplicity, we'll do a full query and count in memory
  // In production with high volume, you might want a different approach
  
  const allItems: AuditLogEntry[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: Object.keys(expressionAttributeNames).length > 0 
          ? expressionAttributeNames 
          : undefined,
        ScanIndexForward: sortOrder === 'asc',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      allItems.push(...(result.Items as AuditLogEntry[]));
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Apply pagination in memory
  const total = allItems.length;
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;
  const paginatedItems = allItems.slice(startIndex, endIndex);

  return {
    items: paginatedItems,
    total,
    page,
    limit,
    hasMore: endIndex < total,
  };
}

/**
 * Get audit logs count for an organization (useful for dashboards)
 */
export async function getAuditLogsCount(orgId: string): Promise<number> {
  let count = 0;
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE,
        KeyConditionExpression: 'orgId = :orgId',
        ExpressionAttributeValues: { ':orgId': orgId },
        Select: 'COUNT',
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    count += result.Count || 0;
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return count;
}
