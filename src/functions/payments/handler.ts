import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ValidationError, validateCreatePayment, validateUpdatePayment } from './validators';
import * as repo from './repository';
import * as creditNotesRepo from '../credit-notes/repository';
import type { PaymentMethod, PaymentStatus } from './types';
import { triggerCreditUsageCalculation } from '../shared/credit-usage-trigger';
import { publishCrudEvent } from '../shared/crud-trigger';
import { requireOrgAccess } from '../shared/auth';

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

console.log('TABLE_PAYMENTS env var:', process.env.TABLE_PAYMENTS);

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/payments
// ---------------------------------------------------------------------------

export const listPayments = async (
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
    const limit = Math.min(100, Math.max(1, parseInt(q.limit ?? '10', 10) || 10));
    const sortBy = q.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = q.sortOrder === 'asc' ? 'asc' : 'desc';
    const status = q.status as PaymentStatus | undefined;
    const method = q.method as PaymentMethod | undefined;

    const VALID_STATUSES: PaymentStatus[] = ['confirmed', 'pending', 'rejected'];
    const VALID_METHODS: PaymentMethod[] = ['cash', 'bank_transfer', 'mobile_payment', 'credit_card', 'other'];

    if (status && !VALID_STATUSES.includes(status)) {
      return clientError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    if (method && !VALID_METHODS.includes(method)) {
      return clientError(400, `method must be one of: ${VALID_METHODS.join(', ')}`);
    }

    const { items, total } = await repo.listPayments({
      orgId,
      search: q.search,
      status,
      method,
      clientId: q.clientId,
      creditNoteId: q.creditNoteId,
      page,
      limit,
      sortBy: sortBy as keyof any,
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
    console.error('listPayments error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/payments/{id}
// ---------------------------------------------------------------------------

export const getPayment = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing payment id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const payment = await repo.getPaymentById(orgId, id);
    if (!payment) return clientError(404, 'Payment not found');

    return respond(200, payment);
  } catch (error) {
    console.error('getPayment error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /orgs/{orgId}/payments
// ---------------------------------------------------------------------------

export const createPayment = async (
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

    const input = validateCreatePayment(body);

    const payment = await repo.createPayment(orgId, input);
    
    // Publish PaymentCreated CRUD event
    publishCrudEvent('PaymentCreated', orgId, payment.id, payment).catch(err =>
      console.warn('Failed to publish PaymentCreated event:', err)
    );

    // Check if credit note is fully paid and publish event for delinquency check
    if (input.creditNoteId) {
      creditNotesRepo.getCreditNoteById(orgId, input.creditNoteId).then(creditNote => {
        if (creditNote && creditNote.status === 'paid') {
          publishCrudEvent('CreditNotePaid', orgId, input.creditNoteId, {
            clientId: input.clientId,
            creditNoteId: input.creditNoteId,
          }).catch(err =>
            console.warn('Failed to publish CreditNotePaid event:', err)
          );
        }
      }).catch(err =>
        console.warn('Failed to check credit note status:', err)
      );
    }
    
    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    return respond(201, payment);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    if ((e as Error).message.includes('Client not found')) return clientError(404, (e as Error).message);
    if ((e as Error).message.includes('Credit note not found')) return clientError(404, (e as Error).message);
    if ((e as Error).message.includes('cannot exceed client accumulated debt')) {
      return clientError(400, (e as Error).message);
    }
    if ((e as Error).message.includes('exceeds credit note remaining balance')) {
      return clientError(400, (e as Error).message);
    }
    if ((e as { name?: string }).name === 'TransactionCanceledException') {
      return clientError(400, 'Payment amount cannot exceed client accumulated debt');
    }
    console.error('createPayment error:', e);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PUT /orgs/{orgId}/payments/{id}
// ---------------------------------------------------------------------------

export const updatePayment = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing payment id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateUpdatePayment(body);

    const payment = await repo.updatePayment(orgId, id, input);
    if (!payment) return clientError(404, 'Payment not found');

    // Publish PaymentUpdated CRUD event
    publishCrudEvent('PaymentUpdated', orgId, payment.id, payment).catch(err =>
      console.warn('Failed to publish PaymentUpdated event:', err)
    );

    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    return respond(200, payment);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    if ((e as Error).message.includes('Client not found')) return clientError(404, (e as Error).message);
    console.error('updatePayment error:', e);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// DELETE /orgs/{orgId}/payments/{id}
// ---------------------------------------------------------------------------

export const deletePayment = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing payment id');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    const deleted = await repo.deletePayment(orgId, id);
    if (!deleted) return clientError(404, 'Payment not found');

    // Publish PaymentDeleted CRUD event
    publishCrudEvent('PaymentDeleted', orgId, id).catch(err =>
      console.warn('Failed to publish PaymentDeleted event:', err)
    );

    // Trigger credit usage calculation asynchronously
    triggerCreditUsageCalculation(orgId).catch(err => 
      console.warn('Failed to trigger credit usage calculation:', err)
    );

    return respond(200, { success: true, message: 'Payment deleted' });
  } catch (error) {
    console.error('deletePayment error:', error);
    return serverError();
  }
};
