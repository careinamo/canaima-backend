import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ValidationError, validateCreateCreditNote, validateUpdateCreditNote } from './validators';
import * as repo from './repository';
import { CreditLimitExceededError } from './repository';
import type { CreditNote, CreditNoteStatus } from './types';
import { triggerCreditUsageCalculation } from '../shared/credit-usage-trigger';
import { publishCrudEvent } from '../shared/crud-trigger';
import { createCreditNoteExpirationRule, deleteCreditNoteExpirationRule, generateRuleName } from './eventbridge-utils';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { EventBridgeClient, DescribeRuleCommand } from '@aws-sdk/client-eventbridge';
import { requireOrgAccess } from '../shared/auth';
import { logAuditEventSync } from '../shared/audit-logger';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  },
  body: JSON.stringify(body),
});

const clientError = (statusCode: number, message: string) =>
  respond(statusCode, { error: message });

const serverError = () => respond(500, { error: 'Internal server error' });

// Initialize AWS clients
const lambdaClient = new LambdaClient({});
const eventBridgeClient = new EventBridgeClient({});

const STACK_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-').slice(0, -1).join('-') || 'canaima-backend';

console.log('TABLE_CREDIT_NOTES env var:', process.env.TABLE_CREDIT_NOTES);

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/credit-notes
// ---------------------------------------------------------------------------

export const listCreditNotes = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    if (!orgId) return clientError(400, 'Missing orgId');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const q = event.queryStringParameters ?? {};

    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? '20', 10) || 20));
    const sortBy = q.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = q.sortOrder === 'desc' ? 'desc' : 'asc';
    const status = q.status as CreditNoteStatus | undefined;

    const VALID_STATUSES: CreditNoteStatus[] = ['pending', 'partial', 'paid'];
    if (status && !VALID_STATUSES.includes(status)) {
      return clientError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }


    const clientId = q.clientId;

    const { items, total } = await repo.listCreditNotes({
      orgId,
      search: q.search,
      status,
      clientId,
      page,
      limit,
      sortBy: sortBy as keyof CreditNote,
      sortOrder,
    });

    return respond(200, {
      data: items,
      pagination: {
        page,
        limit,
        totalPages: Math.ceil(total / limit) || 1,
        totalCount: total,
      },
    });
  } catch (error) {
    console.error('listCreditNotes error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/credit-notes/{id}
// ---------------------------------------------------------------------------

export const getCreditNote = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing credit note id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const creditNote = await repo.getCreditNoteById(orgId, id);
    if (!creditNote) return clientError(404, 'Credit note not found');

    return respond(200, creditNote);
  } catch (error) {
    console.error('getCreditNote error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /orgs/{orgId}/credit-notes
// ---------------------------------------------------------------------------

export const createCreditNote = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    if (!orgId) return clientError(400, 'Missing orgId');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateCreateCreditNote(body);

    const creditNote = await repo.createCreditNote(orgId, input);

    // Publish CreditNoteCreated CRUD event
    publishCrudEvent('CreditNoteCreated', orgId, creditNote.id, creditNote).catch(err =>
      console.warn('Failed to publish CreditNoteCreated event:', err)
    );

    // Create EventBridge rule for credit note expiration (fires at end of dueDate)
    try {
      await createCreditNoteExpirationRule(
        orgId,
        creditNote.id,
        creditNote.dueDate,
        creditNote.clientId,
        input.timezone, // Pass timezone if provided, otherwise uses default
      );
      console.log(`Created EventBridge rule for credit note ${creditNote.id}`);
    } catch (error) {
      console.error(`Failed to create EventBridge rule for credit note ${creditNote.id}:`, error);
      // Don't fail the request if EventBridge rule creation fails
      // Log it but continue - the credit note is created successfully
    }
    
    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    // Log audit event
    await logAuditEventSync(event, 'CREATE', 'credit-note', creditNote.id, undefined, {
      clientId: creditNote.clientId,
      amount: creditNote.amount,
      dueDate: creditNote.dueDate,
      description: creditNote.description,
    });

    return respond(201, creditNote);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    if ((e as Error).message.includes('Client not found')) return clientError(404, (e as Error).message);
    if (e instanceof CreditLimitExceededError) {
      return respond(400, {
        error: 'Credit limit exceeded',
        type: 'CREDIT_LIMIT_EXCEEDED',
        data: {
          creditLimit: e.creditLimit,
          exceedAmount: e.exceedAmount,
        },
      });
    }
    if ((e as { name?: string }).name === 'TransactionCanceledException') {
      return clientError(400, 'Credit limit exceeded for this client');
    }
    console.error('createCreditNote error:', e);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PUT /orgs/{orgId}/credit-notes/{id}
// ---------------------------------------------------------------------------

export const updateCreditNote = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing credit note id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateUpdateCreditNote(body);

    const creditNote = await repo.updateCreditNote(orgId, id, input);
    if (!creditNote) return clientError(404, 'Credit note not found');

    // Publish CreditNoteUpdated CRUD event
    publishCrudEvent('CreditNoteUpdated', orgId, creditNote.id, creditNote).catch(err =>
      console.warn('Failed to publish CreditNoteUpdated event:', err)
    );

    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    // Log audit event
    await logAuditEventSync(event, 'UPDATE', 'credit-note', creditNote.id, undefined, {
      clientId: creditNote.clientId,
      updatedFields: Object.keys(input),
    });

    return respond(200, creditNote);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    console.error('updateCreditNote error:', e);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// DELETE /orgs/{orgId}/credit-notes/{id}
// ---------------------------------------------------------------------------

export const deleteCreditNote = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing credit note id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    // Get the credit note first to capture clientId for the event
    const creditNote = await repo.getCreditNoteById(orgId, id);
    if (!creditNote) return clientError(404, 'Credit note not found');

    const clientId = (creditNote as any).clientId;

    // Delete EventBridge rule for credit note expiration
    try {
      await deleteCreditNoteExpirationRule(orgId, id);
      console.log(`Deleted EventBridge rule for credit note ${id}`);
    } catch (error) {
      console.error(`Failed to delete EventBridge rule for credit note ${id}:`, error);
      // Don't fail the request if EventBridge rule deletion fails
      // Log it but continue - the credit note will still be deleted
    }

    const deleted = await repo.deleteCreditNote(orgId, id);
    if (!deleted) return clientError(404, 'Credit note not found');

    // Publish CreditNoteDeleted CRUD event with clientId (await to ensure it's sent before response)
    await publishCrudEvent('CreditNoteDeleted', orgId, id, { clientId, creditNoteData: creditNote }).catch(err =>
      console.warn('Failed to publish CreditNoteDeleted event:', err)
    );

    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    // Log audit event
    await logAuditEventSync(event, 'DELETE', 'credit-note', id, undefined, {
      clientId: creditNote.clientId,
      amount: creditNote.amount,
    });

    return respond(200, { success: true, message: 'Credit note deleted' });
  } catch (error) {
    console.error('deleteCreditNote error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /orgs/{orgId}/credit-notes/{id}/manual-check-expiration (DEBUG)
// ---------------------------------------------------------------------------

/**
 * Manual endpoint to invoke credit note expiration checking
 * Useful for testing locally without waiting for EventBridge cron
 */
export const checkExpirationManual = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const noteId = event.pathParameters?.id;
    
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!noteId) return clientError(400, 'Missing credit note id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    console.log(`Manual expiration check triggered for note ${noteId} in org ${orgId}`);

    // Get the credit note to retrieve clientId
    const creditNote = await repo.getCreditNoteById(orgId, noteId);
    if (!creditNote) {
      return clientError(404, 'Credit note not found');
    }

    // Invoke the processCreditNoteExpiration Lambda manually
    const functionName = `${STACK_NAME}-processCreditNoteExpiration`;
    
    const result = await lambdaClient.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({
          detail: {
            creditNoteId: noteId,
            orgId,
            clientId: creditNote.clientId,
          },
        }),
      }),
    );

    let responsePayload: any;
    if (result.Payload) {
      responsePayload = JSON.parse(new TextDecoder().decode(result.Payload as Uint8Array));
    }

    console.log(`Manual expiration check completed. Response:`, responsePayload);

    return respond(200, {
      success: true,
      message: 'Manual expiration check executed',
      lambdaResponse: responsePayload,
      statusCode: result.StatusCode,
    });
  } catch (error) {
    console.error('checkExpirationManual error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/credit-notes/{id}/expiration-rule-status (DEBUG)
// ---------------------------------------------------------------------------

/**
 * Debug endpoint to check if EventBridge rule exists and its status
 */
export const getExpirationRuleStatus = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const noteId = event.pathParameters?.id;
    
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!noteId) return clientError(400, 'Missing credit note id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const ruleName = generateRuleName(orgId, noteId);

    console.log(`Checking EventBridge rule status: ${ruleName}`);

    try {
      const ruleInfo = await eventBridgeClient.send(
        new DescribeRuleCommand({
          Name: ruleName,
        }),
      );

      return respond(200, {
        success: true,
        ruleName,
        rule: {
          Name: ruleInfo.Name,
          Description: ruleInfo.Description,
          State: ruleInfo.State,
          ScheduleExpression: ruleInfo.ScheduleExpression,
          Arn: ruleInfo.Arn,
        },
      });
    } catch (err: any) {
      // Rule not found
      if (err.name === 'ResourceNotFoundException') {
        return respond(404, {
          success: false,
          message: 'EventBridge rule not found',
          ruleName,
          error: `No rule named "${ruleName}" exists`,
        });
      }
      throw err;
    }
  } catch (error) {
    console.error('getExpirationRuleStatus error:', error);
    return serverError();
  }
};
