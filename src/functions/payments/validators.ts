import type { CreatePaymentInput, UpdatePaymentInput } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function validateCreatePayment(body: unknown): CreatePaymentInput {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('Body must be an object');
  }

  const input = body as Record<string, unknown>;

  // Validate required fields
  if (!input.creditNoteId || typeof input.creditNoteId !== 'string') {
    throw new ValidationError('creditNoteId is required and must be a string');
  }

  if (!input.clientId || typeof input.clientId !== 'string') {
    throw new ValidationError('clientId is required and must be a string');
  }

  if (typeof input.amount !== 'number' || input.amount <= 0) {
    throw new ValidationError('amount is required and must be a positive number');
  }

  if (!input.method || typeof input.method !== 'string') {
    throw new ValidationError('method is required and must be a string');
  }

  const validMethods = ['cash', 'bank_transfer', 'mobile_payment', 'credit_card', 'other'];
  if (!validMethods.includes(input.method)) {
    throw new ValidationError(`method must be one of: ${validMethods.join(', ')}`);
  }

  // Validate optional status
  if (input.status && !['confirmed', 'pending', 'rejected'].includes(String(input.status))) {
    throw new ValidationError('status must be one of: confirmed, pending, rejected');
  }

  // Validate number format if provided
  if (input.number && typeof input.number !== 'string') {
    throw new ValidationError('number must be a string');
  }

  if (input.bankName && typeof input.bankName !== 'string') {
    throw new ValidationError('bankName must be a string');
  }

  if (input.reference && typeof input.reference !== 'string') {
    throw new ValidationError('reference must be a string');
  }

  if (input.description && typeof input.description !== 'string') {
    throw new ValidationError('description must be a string');
  }

  return {
    number: input.number as string | undefined,
    creditNoteId: input.creditNoteId,
    clientId: input.clientId,
    amount: input.amount,
    method: input.method as any,
    status: (input.status as 'confirmed' | 'pending' | 'rejected') || 'pending',
    bankName: input.bankName as string | undefined,
    reference: input.reference as string | undefined,
    description: input.description as string | undefined,
  };
}

export function validateUpdatePayment(body: unknown): UpdatePaymentInput {
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

  if (input.invoiceNumber !== undefined && typeof input.invoiceNumber !== 'string') {
    throw new ValidationError('invoiceNumber must be a string');
  }

  if (input.amount !== undefined && (typeof input.amount !== 'number' || input.amount <= 0)) {
    throw new ValidationError('amount must be a positive number');
  }

  if (input.method && !['cash', 'bank_transfer', 'mobile_payment', 'credit_card', 'other'].includes(String(input.method))) {
    throw new ValidationError('method must be one of: cash, bank_transfer, mobile_payment, credit_card, other');
  }

  if (input.status && !['confirmed', 'pending', 'rejected'].includes(String(input.status))) {
    throw new ValidationError('status must be one of: confirmed, pending, rejected');
  }

  if (input.bankName !== undefined && typeof input.bankName !== 'string') {
    throw new ValidationError('bankName must be a string');
  }

  if (input.reference !== undefined && typeof input.reference !== 'string') {
    throw new ValidationError('reference must be a string');
  }

  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new ValidationError('description must be a string');
  }

  return {
    number: input.number as string | undefined,
    clientId: input.clientId as string | undefined,
    invoiceNumber: input.invoiceNumber as string | undefined,
    amount: input.amount as number | undefined,
    method: input.method as any,
    status: input.status as 'confirmed' | 'pending' | 'rejected' | undefined,
    bankName: input.bankName as string | undefined,
    reference: input.reference as string | undefined,
    description: input.description as string | undefined,
  };
}
