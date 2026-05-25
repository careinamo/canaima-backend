import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ValidationError, validateCreateClient, validateUpdateClient, parseCsvClients } from './validators';
import * as repo from './repository';

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

console.log('TABLE_CLIENTS env var:', process.env.TABLE_CLIENTS);
console.log('REGION env var:', process.env.AWS_REGION);

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/clients
// ---------------------------------------------------------------------------

export const listClients = async (
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
    const active = q.active !== undefined ? q.active === 'true' : undefined;
    const delinquent = q.delinquent !== undefined ? q.delinquent === 'true' : undefined;

    const { items, total } = await repo.listClients({
      orgId,
      search: q.search,
      active,
      delinquent,
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
  } catch (error) {
    console.error('listClients error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/clients/{id}
// ---------------------------------------------------------------------------

export const getClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing client id');

    const client = await repo.getClientById(orgId, id);
    if (!client) return clientError(404, 'Client not found');

    return respond(200, client);
  } catch (error) {
    console.error('getClient error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /orgs/{orgId}/clients
// ---------------------------------------------------------------------------

export const createClient = async (
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

    const input = validateCreateClient(body);

    const existing = await repo.findClientByEmail(input.email);
    if (existing) return clientError(409, 'A client with this email already exists');

    const client = await repo.createClient(orgId, input);
    return respond(201, client);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// PUT /orgs/{orgId}/clients/{id}
// ---------------------------------------------------------------------------

export const updateClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
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

    const client = await repo.updateClient(orgId, id, input);
    if (!client) return clientError(404, 'Client not found');

    return respond(200, client);
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    console.error('updateClient error:', e);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// DELETE /orgs/{orgId}/clients/{id}
// ---------------------------------------------------------------------------

export const deleteClient = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    const id = event.pathParameters?.id;
    if (!orgId) return clientError(400, 'Missing orgId');
    if (!id) return clientError(400, 'Missing client id');

    const deleted = await repo.deleteClient(orgId, id);
    if (!deleted) return clientError(404, 'Client not found');

    return respond(200, { success: true, message: 'Client deleted' });
  } catch (error) {
    console.error('deleteClient error:', error);
    return serverError();
  }
};

// ---------------------------------------------------------------------------
// POST /orgs/{orgId}/clients/bulk-import
// ---------------------------------------------------------------------------

export const bulkImportClients = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    if (!orgId) return clientError(400, 'Missing orgId');

    const csvContent = event.body ?? '';
    if (!csvContent.trim()) {
      return clientError(400, 'Request body (CSV content) is required');
    }

    // Parse and validate CSV
    const parseResult = parseCsvClients(csvContent);

    if (parseResult.valid.length === 0) {
      return respond(400, {
        error: 'No valid rows to import',
        csvErrors: parseResult.errors,
      });
    }

    // Create clients in batch
    const inputs = parseResult.valid.map(row => row.data);
    const result = await repo.createClientsBatch(orgId, inputs);

    return respond(202, {
      summary: {
        totalRows: parseResult.valid.length + parseResult.errors.length,
        validRows: parseResult.valid.length,
        createdCount: result.created.length,
        failedCount: result.errors.length,
      },
      created: result.created,
      errors: [...parseResult.errors, ...result.errors],
    });
  } catch (e) {
    if (e instanceof ValidationError) return clientError(400, e.message);
    console.error('bulkImportClients error:', e);
    return serverError();
  }
};
