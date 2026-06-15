import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { requireOrgAccess } from '../shared/auth';
import { getCreditNotesThisMonthKPI, getCollectedThisMonthKPI } from './repository';

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

const respond = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  },
  body: JSON.stringify(body),
});

const clientError = (statusCode: number, message: string) =>
  respond(statusCode, { error: message });

const serverError = () => respond(500, { error: 'Internal server error' });

// ---------------------------------------------------------------------------
// GET /orgs/{orgId}/dashboard-metrics?as_of=YYYY-MM-DD
// ---------------------------------------------------------------------------

// Validate date format YYYY-MM-DD
const isValidDateFormat = (dateStr: string): boolean => {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
};

// Get today's date in YYYY-MM-DD format
const getTodayDate = (): string => {
  return new Date().toISOString().split('T')[0];
};

export const getDashboardMetrics = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.orgId;
    if (!orgId) return clientError(400, 'Missing orgId');

    // Validate user has access to this organization
    const accessDenied = requireOrgAccess(event, orgId);
    if (accessDenied) return accessDenied;

    // Parse query parameters
    const queryParams = event.queryStringParameters ?? {};
    const asOfParam = queryParams.as_of;

    // Validate as_of parameter if provided
    let asOf: string;
    if (asOfParam) {
      if (!isValidDateFormat(asOfParam)) {
        return clientError(400, 'Invalid as_of date format. Expected YYYY-MM-DD');
      }
      asOf = asOfParam;
    } else {
      // Default to today if not provided
      asOf = getTodayDate();
    }

    // TODO: Aquí se agregarán las queries a DynamoDB para obtener las métricas reales
    // Obtenemos las métricas reales de la tabla de métricas

    // Fetch KPIs from DynamoDB
    const creditNotesThisMonthKPI = await getCreditNotesThisMonthKPI(orgId, asOf);
    const collectedThisMonthKPI = await getCollectedThisMonthKPI(orgId, asOf);

    const metrics = {
      as_of: asOf,
      range: "6m",
      currency: "USD",
      timezone: "America/Caracas",
      generated_at: new Date().toISOString(),

      kpis: {
        credit_notes_this_month: creditNotesThisMonthKPI,
        collected_this_month: collectedThisMonthKPI,
        delinquent_clients:   { value:     12, delta_abs:     3, delta_direction: "down", compare_to: "previous_month" },
        credit_utilization:   { value:   0.68, delta_pct:  -2.0, delta_direction: "up",   compare_to: "previous_month", unit: "ratio" }
      },

      aging: {
        buckets: [
          { range: "0-30",  current: 85000, overdue:     0 },
          { range: "31-60", current: 24000, overdue: 42000 },
          { range: "61-90", current: 15500, overdue: 28500 },
          { range: "90+",   current: 12000, overdue: 18300 }
        ]
      },

      collections_vs_credits: {
        granularity: "month",
        series: [
          { period: "2026-01", label: "Ene", credits: 32000, collections: 28000 },
          { period: "2026-02", label: "Feb", credits: 28000, collections: 31000 },
          { period: "2026-03", label: "Mar", credits: 45000, collections: 35000 },
          { period: "2026-04", label: "Abr", credits: 38000, collections: 40000 },
          { period: "2026-05", label: "May", credits: 52000, collections: 42000 },
          { period: "2026-06", label: "Jun", credits: 41000, collections: 38420 }
        ]
      },

      delinquency_trend: {
        granularity: "month",
        series: [
          { period: "2026-01", label: "Ene", overdue: 22000 },
          { period: "2026-02", label: "Feb", overdue: 25000 },
          { period: "2026-03", label: "Mar", overdue: 31000 },
          { period: "2026-04", label: "Abr", overdue: 28000 },
          { period: "2026-05", label: "May", overdue: 35000 },
          { period: "2026-06", label: "Jun", overdue: 32800 }
        ]
      },

      client_distribution: {
        total: 61800,
        items: [
          { client_id: "cli_01", name: "Comercial El Rey",     value: 18500, percent: 0.299 },
          { client_id: "cli_02", name: "Distribuidora López",  value: 12300, percent: 0.199 },
          { client_id: "cli_03", name: "Inversiones Torres",   value:  8900, percent: 0.144 },
          { client_id: "cli_04", name: "Supermercado Central", value:  6200, percent: 0.100 },
          { client_id: null,     name: "Otros",                value: 15900, percent: 0.257, is_aggregate: true }
        ]
      },

      top_delinquents: {
        items: [
          {
            client_id: "cli_07",
            name: "Comercial El Rey",
            overdue_amount: 12450,
            days_overdue: 45,
            invoices_count: 3,
            status: "delinquent"
          }
        ]
      }
    };

    return respond(200, { data: metrics });
  } catch (error) {
    console.error('getDashboardMetrics error:', error);
    return serverError();
  }
};
