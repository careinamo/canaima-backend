export interface CreditUsageRecord {
  PK: string; // CreditUsed#orgId
  SK: string; // YYYY-MM-DD (ISO date)
  orgId: string;
  value: number; // Percentage with max 2 decimals
  totalAccumulatedDebt: number;
  totalCreditLimit: number;
  activeClientsCount: number;
  createdAt: string; // ISO 8601 timestamp
  updatedAt: string; // ISO 8601 timestamp
}

export interface CreditUsageInput {
  orgId: string;
}
