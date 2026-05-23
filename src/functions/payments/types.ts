export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_payment' | 'credit_card' | 'other';
export type PaymentStatus = 'confirmed' | 'pending' | 'rejected';

export interface Payment {
  id: string;
  orgId: string;
  number: string;
  creditNoteId: string;
  clientId: string;
  clientName: string;
  invoiceNumber: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  bankName?: string;
  reference?: string;
  description?: string;
  clientAccumulatedDebtAtRecord: number;
  clientCreditLimitAtRecord: number;
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes PK/SK and GSI fields */
export interface PaymentRecord extends Payment {
  PK: string; // org#<orgId>
  SK: string; // payment#<paymentId>
  clientIdGSI: string;
  creditNoteIdGSI: string;
  statusGSI: PaymentStatus;
  methodGSI: PaymentMethod;
  numberLower: string;
}

export interface CreatePaymentInput {
  number?: string;
  creditNoteId: string;
  clientId: string;
  invoiceNumber: string;
  amount: number;
  method: PaymentMethod;
  status?: PaymentStatus;
  bankName?: string;
  reference?: string;
  description?: string;
}

export interface UpdatePaymentInput {
  number?: string;
  creditNoteId?: string;
  clientId?: string;
  invoiceNumber?: string;
  amount?: number;
  method?: PaymentMethod;
  status?: PaymentStatus;
  bankName?: string;
  reference?: string;
  description?: string;
}

export interface ListPaymentsParams {
  orgId: string;
  search?: string;
  status?: PaymentStatus;
  method?: PaymentMethod;
  clientId?: string;
  creditNoteId?: string;
  page: number;
  limit: number;
  sortBy: keyof Payment;
  sortOrder: 'asc' | 'desc';
}
