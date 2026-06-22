export interface Client {
  id: string;
  orgId: string;
  name: string;
  document?: string; // Client document ID (e.g., V20345537, J148536972)
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
  delinquent: boolean;
  creditLimit: number;
  accumulatedDebt: number;
  lastPayment?: string;
  notes?: string;
  timezone?: string; // Timezone for createdAt/updatedAt (e.g., 'America/Caracas')
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes PK/SK and lowercase fields */
export interface ClientRecord extends Client {
  PK: string;   // org#<orgId>
  SK: string;    // client#<clientId>
  nameLower: string;
  emailLower?: string;
}

export interface CreateClientInput {
  name: string;
  document?: string;
  email?: string;
  phone?: string;
  address?: string;
  active: boolean;
  delinquent?: boolean;
  creditLimit: number;
  accumulatedDebt?: number;
  notes?: string;
}

export interface UpdateClientInput {
  name?: string;
  document?: string;
  email?: string;
  phone?: string;
  address?: string;
  active?: boolean;
  delinquent?: boolean;
  creditLimit?: number;
  accumulatedDebt?: number;
  notes?: string;
}

export interface ListClientsParams {
  orgId: string;
  search?: string;
  active?: boolean;
  delinquent?: boolean;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}
