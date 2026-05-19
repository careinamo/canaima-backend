export type ClientStatus = 'active' | 'inactive' | 'overdue';

export interface Client {
  id: string;
  orgId: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  status: ClientStatus;
  creditLimit: number;
  accumulatedDebt: number;
  lastPayment?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes PK/SK and lowercase fields */
export interface ClientRecord extends Client {
  PK: string;   // org#<orgId>
  SK: string;    // client#<clientId>
  nameLower: string;
  emailLower: string;
}

export interface CreateClientInput {
  name: string;
  email: string;
  phone?: string;
  address?: string;
  status: ClientStatus;
  creditLimit: number;
  notes?: string;
}

export interface UpdateClientInput {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
  status?: ClientStatus;
  creditLimit?: number;
  notes?: string;
}

export interface ListClientsParams {
  orgId: string;
  search?: string;
  status?: ClientStatus;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}
