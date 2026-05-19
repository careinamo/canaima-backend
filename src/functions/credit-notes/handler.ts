import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ValidationError, validateCreateCreditNote, validateUpdateCreditNote } from './validators';
import * as repo from './repository';
import { CreditLimitExceededError } from './repository';
import type { CreditNote, CreditNoteStatus } from './types';

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

    const { items, total } = await repo.listCreditNotes({
      orgId,
      search: q.search,
      status,
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

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateCreateCreditNote(body);

    const creditNote = await repo.createCreditNote(orgId, input);
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

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateUpdateCreditNote(body);

    const creditNote = await repo.updateCreditNote(orgId, id, input);
    if (!creditNote) return clientError(404, 'Credit note not found');

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

    const deleted = await repo.deleteCreditNote(orgId, id);
    if (!deleted) return clientError(404, 'Credit note not found');

    return respond(200, { success: true, message: 'Credit note deleted' });
  } catch (error) {
    console.error('deleteCreditNote error:', error);
    return serverError();
  }
};
