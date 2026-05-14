import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ValidationError, validateCreateClient, validateUpdateClient } from './validators';
import * as repo from './repository';
import type { ClientStatus } from './types';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const clientError = (statusCode: number, message: string) =>
  respond(statusCode, { error: message });

const serverError = () => respond(500, { error: 'Internal server error' });

// ---------------------------------------------------------------------------
// GET /clients
// ---------------------------------------------------------------------------

export const listClients = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const q = event.queryStringParameters ?? {};

    const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
    // Allow a high limit (e.g. 500) so the frontend can request all rows for CSV export
    const limit = Math.min(500, Math.max(1, parseInt(q.limit ?? '20', 10) || 20));
    const sortBy = q.sortBy ?? 'createdAt';
    const sortOrder: 'asc' | 'desc' = q.sortOrder === 'desc' ? 'desc' : 'asc';
    const status = q.status as ClientStatus | undefined;

    const VALID_STATUSES: ClientStatus[] = ['active', 'inactive', 'overdue'];
    if (status && !VALID_STATUSES.includes(status)) {
      return clientError(400, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    }

    const { items, total } = await repo.listClients({
      search: q.search,
      status,
      page,
      limit,
      sortBy,
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
  } catch {
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /clients/{id}
// ---------------------------------------------------------------------------

export const getClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return clientError(400, 'Missing client id');

    const client = await repo.getClientById(id);
    if (!client) return clientError(404, 'Client not found');

    return respond(200, client);
  } catch {
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /clients
// ---------------------------------------------------------------------------

export const createClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateCreateClient(body);

    const existing = await repo.findClientByEmail(input.email);
    if (existing) return clientError(409, 'A client with this email already exists');

    const client = await repo.createClient(input);
    return respond(201, client);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PUT /clients/{id}
// ---------------------------------------------------------------------------

export const updateClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return clientError(400, 'Missing client id');

    let body: unknown;
    try {
      body = JSON.parse(event.body ?? '{}');
    } catch {
      return clientError(400, 'Invalid JSON body');
    }

    const input = validateUpdateClient(body);

    if (input.email) {
      const existing = await repo.findClientByEmail(input.email);
      if (existing && existing.id !== id) {
        return clientError(409, 'A client with this email already exists');
      }
    }

    const client = await repo.updateClient(id, input);
    if (!client) return clientError(404, 'Client not found');

    return respond(200, client);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// DELETE /clients/{id}
// ---------------------------------------------------------------------------

export const deleteClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const id = event.pathParameters?.id;
    if (!id) return clientError(400, 'Missing client id');

    const deleted = await repo.deleteClient(id);
    if (!deleted) return clientError(404, 'Client not found');

    return respond(200, { success: true, message: 'Client deleted' });
  } catch {
    return serverError();
  }
};
