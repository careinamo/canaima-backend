import type { CreateCreditNoteInput, UpdateCreditNoteInput } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateCreateCreditNote(body: unknown): CreateCreditNoteInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Body must be an object');
  }

  const input = body as Record<string, unknown>;

  // Validate required fields
  if (!input.clientId || typeof input.clientId !== 'string') {
    throw new ValidationError('clientId is required and must be a string');
  }

  if (!input.clientName || typeof input.clientName !== 'string') {
    throw new ValidationError('clientName is required and must be a string');
  }

  if (!input.invoiceNumber || typeof input.invoiceNumber !== 'string') {
    throw new ValidationError('invoiceNumber is required and must be a string');
  }

  if (typeof input.amount !== 'number' || input.amount <= 0) {
    throw new ValidationError('amount is required and must be a positive number');
  }

  if (!input.dueDate || typeof input.dueDate !== 'string') {
    throw new ValidationError('dueDate is required and must be a string (ISO 8601)');
  }

  // Validate date format
  const dueDateObj = new Date(input.dueDate);
  if (isNaN(dueDateObj.getTime())) {
    throw new ValidationError('dueDate must be a valid ISO 8601 date');
  }

  // Validate status if provided
  if (input.status && !['pending', 'partial', 'paid'].includes(input.status)) {
    throw new ValidationError('status must be one of: pending, partial, paid');
  }

  // Validate number format if provided
  if (input.number && typeof input.number !== 'string') {
    throw new ValidationError('number must be a string');
  }

  return {
    number: input.number as string | undefined,
    clientId: input.clientId,
    clientName: input.clientName,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    status: (input.status as 'pending' | 'partial' | 'paid') || 'pending',
    dueDate: input.dueDate,
    description: input.description as string | undefined,
  };
}

export function validateUpdateCreditNote(body: unknown): UpdateCreditNoteInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Body must be an object');
  }

  const input = body as Record<string, unknown>;

  if (input.number !== undefined && typeof input.number !== 'string') {
    throw new ValidationError('number must be a string');
  }

  if (input.clientId !== undefined && typeof input.clientId !== 'string') {
    throw new ValidationError('clientId must be a string');
  }

  if (input.clientName !== undefined && typeof input.clientName !== 'string') {
    throw new ValidationError('clientName must be a string');
  }

  if (input.invoiceNumber !== undefined && typeof input.invoiceNumber !== 'string') {
    throw new ValidationError('invoiceNumber must be a string');
  }

  if (input.amount !== undefined && (typeof input.amount !== 'number' || input.amount <= 0)) {
    throw new ValidationError('amount must be a positive number');
  }

  if (input.dueDate !== undefined && typeof input.dueDate !== 'string') {
    throw new ValidationError('dueDate must be a string (ISO 8601)');
  }

  if (input.dueDate) {
    const dueDateObj = new Date(input.dueDate);
    if (isNaN(dueDateObj.getTime())) {
      throw new ValidationError('dueDate must be a valid ISO 8601 date');
    }
  }

  if (input.status && !['pending', 'partial', 'paid'].includes(input.status)) {
    throw new ValidationError('status must be one of: pending, partial, paid');
  }

  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new ValidationError('description must be a string');
  }

  return {
    number: input.number as string | undefined,
    clientId: input.clientId as string | undefined,
    clientName: input.clientName as string | undefined,
    invoiceNumber: input.invoiceNumber as string | undefined,
    amount: input.amount as number | undefined,
    status: input.status as 'pending' | 'partial' | 'paid' | undefined,
    dueDate: input.dueDate as string | undefined,
    description: input.description as string | undefined,
  };
}
