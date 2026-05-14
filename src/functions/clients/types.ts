export type ClientStatus = 'active' | 'inactive' | 'overdue';

export interface Client {
  id: string;
  name: string;
  email: string;
  phone?: string;
  address?: string;
  status: ClientStatus;
  creditLimit: number;
  balance: number;
  lastPayment?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/** Internal DynamoDB record — includes lowercase fields for case-insensitive search */
export interface ClientRecord extends Client {
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
  search?: string;
  status?: ClientStatus;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}
