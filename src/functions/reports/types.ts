/**
 * Report types for client debt reports
 */

export interface ClientReportRow {
  name: string;
  document: string;
  accumulatedDebt: number;
}

export interface GenerateClientReportInput {
  orgId: string;
}

export interface GenerateClientReportResponse {
  success: boolean;
  downloadUrl: string;
  expiresIn: number; // seconds
  fileName: string;
  generatedAt: string;
  totalClients: number;
  totalDebt: number;
}
