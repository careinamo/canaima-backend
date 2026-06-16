export type CreditNoteStatus = 'pending' | 'partial' | 'paid' | 'overdue';

export interface CreditNote {
  id: string;
  number: string;
  orgId: string;
  clientId: string;
  clientName: string;
  invoiceNumber?: string;
  amount: number;
  paid: number;
  status: CreditNoteStatus;
  dueDate: string;
  description?: string;
  clientAccumulatedDebtAtRecord: number;
  clientCreditLimitAtRecord: number;
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes PK/SK and lowercase fields */
export interface CreditNoteRecord extends CreditNote {
  PK: string; // org#<orgId>
  SK: string; // creditnote#<noteId>
  statusGSI: CreditNoteStatus; // For GSI
  clientIdGSI: string; // For GSI
  numberLower: string;
}

export interface CreateCreditNoteInput {
  number?: string; // Optional, auto-generated if not provided
  clientId: string;
  clientName: string;
  invoiceNumber?: string;
  amount: number;
  status?: CreditNoteStatus;
  dueDate: string;
  description?: string;
  timezone?: string; // Optional: timezone for end-of-day calculation (e.g., 'America/Caracas'), defaults to America/Caracas
}

export interface UpdateCreditNoteInput {
  number?: string;
  clientId?: string;
  clientName?: string;
  invoiceNumber?: string;
  amount?: number;
  status?: CreditNoteStatus;
  dueDate?: string;
  description?: string;
}

export interface ListCreditNotesParams {
  orgId: string;
  search?: string;
  status?: CreditNoteStatus;
  clientId?: string;
  page: number;
  limit: number;
  sortBy: keyof CreditNote;
  sortOrder: 'asc' | 'desc';
}
