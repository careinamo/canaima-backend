export type PaymentMethod = 'cash' | 'bank_transfer' | 'mobile_payment' | 'credit_card' | 'other';
export type PaymentStatus = 'confirmed' | 'pending' | 'rejected';

export interface Payment {
  id: string;
  orgId: string;
  number: string;
  clientId: string;
  clientName: string;
  invoiceNumber: string;
  amount: number;
  method: PaymentMethod;
  status: PaymentStatus;
  bankName?: string;
  reference?: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes PK/SK and GSI fields */
export interface PaymentRecord extends Payment {
  PK: string; // org#<orgId>
  SK: string; // payment#<paymentId>
  clientIdGSI: string;
  statusGSI: PaymentStatus;
  methodGSI: PaymentMethod;
  numberLower: string;
}

export interface CreatePaymentInput {
  number?: string;
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
  page: number;
  limit: number;
  sortBy: keyof Payment;
  sortOrder: 'asc' | 'desc';
}
