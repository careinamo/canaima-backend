import type { ClientStatus, CreateClientInput, UpdateClientInput } from './types';

const VALID_STATUSES: ClientStatus[] = ['active', 'inactive', 'overdue'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateCreateClient(body: unknown): CreateClientInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;

  if (!input.name || typeof input.name !== 'string' || !String(input.name).trim()) {
    throw new ValidationError('name is required');
  }
  if (!input.email || typeof input.email !== 'string' || !String(input.email).trim()) {
    throw new ValidationError('email is required');
  }
  if (!EMAIL_REGEX.test(String(input.email).trim())) {
    throw new ValidationError('email format is invalid');
  }

  const status: ClientStatus = (input.status as ClientStatus) ?? 'active';
  if (!VALID_STATUSES.includes(status)) {
    throw new ValidationError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  const creditLimit = input.creditLimit !== undefined ? Number(input.creditLimit) : 0;
  if (isNaN(creditLimit) || creditLimit < 0) {
    throw new ValidationError('creditLimit must be a non-negative number');
  }

  return {
    name: String(input.name).trim(),
    email: String(input.email).toLowerCase().trim(),
    status,
    creditLimit,
    phone: input.phone ? String(input.phone).trim() : undefined,
    address: input.address ? String(input.address).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
  };
}

export function validateUpdateClient(body: unknown): UpdateClientInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const result: UpdateClientInput = {};

  if ('name' in input) {
    if (!input.name || !String(input.name).trim()) {
      throw new ValidationError('name cannot be empty');
    }
    result.name = String(input.name).trim();
  }

  if ('email' in input) {
    const email = String(input.email ?? '').trim();
    if (!email || !EMAIL_REGEX.test(email)) {
      throw new ValidationError('email format is invalid');
    }
    result.email = email.toLowerCase();
  }

  if ('status' in input) {
    if (!VALID_STATUSES.includes(input.status as ClientStatus)) {
      throw new ValidationError(`status must be one of: ${VALID_STATUSES.join(', ')}`);
    }
    result.status = input.status as ClientStatus;
  }

  if ('creditLimit' in input) {
    const creditLimit = Number(input.creditLimit);
    if (isNaN(creditLimit) || creditLimit < 0) {
      throw new ValidationError('creditLimit must be a non-negative number');
    }
    result.creditLimit = creditLimit;
  }

  if ('phone' in input) result.phone = input.phone ? String(input.phone).trim() : undefined;
  if ('address' in input) result.address = input.address ? String(input.address).trim() : undefined;
  if ('notes' in input) result.notes = input.notes ? String(input.notes).trim() : undefined;

  return result;
}

/**
 * Parse and validate a CSV string with client data.
 * Expected format: CSV with header row
 * Columns: name, email, phone, address, status, creditLimit, notes
 * Maximum 50 rows allowed.
 */
export interface ParsedCsvRow {
  data: CreateClientInput;
  rowNumber: number;
}

export interface CsvParseResult {
  valid: ParsedCsvRow[];
  errors: Array<{ rowNumber: number; error: string }>;
}

export function parseCsvClients(csvContent: string): CsvParseResult {
  const lines = csvContent.trim().split('\n');
  
  if (lines.length < 2) {
    throw new ValidationError('CSV must have header row and at least one data row');
  }

  const headerLine = lines[0];
  const headers = headerLine.split(',').map(h => h.trim().toLowerCase());
  
  // Validate header
  const requiredHeaders = ['name', 'email'];
  for (const required of requiredHeaders) {
    if (!headers.includes(required)) {
      throw new ValidationError(`CSV must include '${required}' column`);
    }
  }

  const valid: ParsedCsvRow[] = [];
  const errors: Array<{ rowNumber: number; error: string }> = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue; // Skip empty lines

    if (valid.length >= 50) {
      errors.push({ rowNumber: i + 1, error: 'Maximum 50 clients allowed per import' });
      continue;
    }

    const cells = line.split(',').map(cell => cell.trim());
    const row: Record<string, string> = {};

    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] || '';
    }

    try {
      const clientInput = validateCreateClient(row);
      valid.push({ data: clientInput, rowNumber: i + 1 });
    } catch (e) {
      const message = e instanceof ValidationError ? e.message : 'Unknown error';
      errors.push({ rowNumber: i + 1, error: message });
    }
  }

  return { valid, errors };
}
