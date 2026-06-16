import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_METRICS = process.env.TABLE_METRICS as string;
const TABLE_CREDIT_NOTES = process.env.TABLE_CREDIT_NOTES as string;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/**
 * Get the previous month in YYYY-MM format
 */
export function getPreviousMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const date = new Date(year, month - 2, 1); // month - 2 because Date months are 0-indexed
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Get the same day from the previous month (YYYY-MM-DD format)
 * If the day doesn't exist in the previous month, returns the last day of that month
 */
export function getSameDayPreviousMonth(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const prevDate = new Date(year, month - 2, day); // month - 2 because Date is 0-indexed
  
  // If day overflowed (e.g., March 31 -> Feb 31 becomes March 3), go to last day of prev month
  if (prevDate.getMonth() !== (month - 2 + 12) % 12) {
    prevDate.setDate(0); // Last day of previous month
  }
  
  return `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
}

/**
 * Get year-month from a date string YYYY-MM-DD
 */
export function getYearMonth(dateStr: string): string {
  return dateStr.substring(0, 7); // "2026-06-15" -> "2026-06"
}

/**
 * Get day of month from date string
 */
export function getDayOfMonth(dateStr: string): number {
  return parseInt(dateStr.split('-')[2], 10);
}

/**
 * Get total days in a month
 */
export function getDaysInMonth(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return new Date(year, month, 0).getDate();
}

/**
 * Calculate projection and delta percentage
 * @param currentValue - Value accumulated so far this month
 * @param previousValue - Total value from previous month
 * @param dayOfMonth - Current day of the month
 * @param daysInMonth - Total days in current month
 * @returns { projection, deltaPct, deltaDirection }
 */
export function calculateProjectionAndDelta(
  currentValue: number,
  previousValue: number,
  dayOfMonth: number,
  daysInMonth: number
): { projection: number; deltaPct: number; deltaDirection: 'up' | 'down' } {
  // Project the current value to end of month
  const dailyAverage = dayOfMonth > 0 ? currentValue / dayOfMonth : 0;
  const projection = Math.round(dailyAverage * daysInMonth);

  // Calculate delta percentage vs previous month
  let deltaPct = 0;
  if (previousValue > 0) {
    deltaPct = Math.round(((projection - previousValue) / previousValue) * 1000) / 10; // Round to 1 decimal
  } else if (projection > 0) {
    deltaPct = 100; // If previous was 0 and current is positive, 100% increase
  }

  const deltaDirection: 'up' | 'down' = deltaPct >= 0 ? 'up' : 'down';

  return { projection, deltaPct: Math.abs(deltaPct), deltaDirection };
}

// ---------------------------------------------------------------------------
// Metrics queries
// ---------------------------------------------------------------------------

interface MetricRecord {
  PK: string;
  SK: string;
  value: number;
  updatedAt: string;
}

/**
 * Get a metric value from the metrics table
 * @param metricPrefix - The metric type prefix (e.g., "CreditNotesTotalMonth")
 * @param orgId - Organization ID
 * @param period - Period in YYYY-MM format
 * @returns The metric value or 0 if not found
 */
export async function getMetricValue(
  metricPrefix: string,
  orgId: string,
  period: string
): Promise<number> {
  const pk = `${metricPrefix}#${orgId}`;
  
  const result = await ddb.send(
    new GetCommand({
      TableName: TABLE_METRICS,
      Key: {
        PK: pk,
        SK: period,
      },
    })
  );

  return (result.Item as MetricRecord)?.value ?? 0;
}

// ---------------------------------------------------------------------------
// KPI: Credit Notes This Month
// ---------------------------------------------------------------------------

export interface CreditNotesKPI {
  value: number;
  delta_pct: number;
  delta_direction: 'up' | 'down';
  compare_to: string;
}

/**
 * Get Credit Notes This Month KPI
 * Fetches the total credit notes amount for the current month and calculates
 * the projected delta compared to the previous month.
 */
export async function getCreditNotesThisMonthKPI(
  orgId: string,
  asOf: string
): Promise<CreditNotesKPI> {
  const currentMonth = getYearMonth(asOf);
  const previousMonth = getPreviousMonth(currentMonth);
  const dayOfMonth = getDayOfMonth(asOf);
  const daysInMonth = getDaysInMonth(currentMonth);

  // Fetch current and previous month values in parallel
  const [currentValue, previousValue] = await Promise.all([
    getMetricValue('CreditNotesTotalMonth', orgId, currentMonth),
    getMetricValue('CreditNotesTotalMonth', orgId, previousMonth),
  ]);

  // Calculate projection and delta
  const { deltaPct, deltaDirection } = calculateProjectionAndDelta(
    currentValue,
    previousValue,
    dayOfMonth,
    daysInMonth
  );

  return {
    value: currentValue,
    delta_pct: deltaPct,
    delta_direction: deltaDirection,
    compare_to: 'previous_month',
  };
}

// ---------------------------------------------------------------------------
// KPI: Collected This Month (Payments)
// ---------------------------------------------------------------------------

export interface CollectedKPI {
  value: number;
  delta_pct: number;
  delta_direction: 'up' | 'down';
  compare_to: string;
}

/**
 * Get Collected This Month KPI
 * Fetches the total payments amount for the current month and calculates
 * the projected delta compared to the previous month.
 */
export async function getCollectedThisMonthKPI(
  orgId: string,
  asOf: string
): Promise<CollectedKPI> {
  const currentMonth = getYearMonth(asOf);
  const previousMonth = getPreviousMonth(currentMonth);
  const dayOfMonth = getDayOfMonth(asOf);
  const daysInMonth = getDaysInMonth(currentMonth);

  // Fetch current and previous month values in parallel
  const [currentValue, previousValue] = await Promise.all([
    getMetricValue('PaymentsTotalMonth', orgId, currentMonth),
    getMetricValue('PaymentsTotalMonth', orgId, previousMonth),
  ]);

  // Calculate projection and delta
  const { deltaPct, deltaDirection } = calculateProjectionAndDelta(
    currentValue,
    previousValue,
    dayOfMonth,
    daysInMonth
  );

  return {
    value: currentValue,
    delta_pct: deltaPct,
    delta_direction: deltaDirection,
    compare_to: 'previous_month',
  };
}

// ---------------------------------------------------------------------------
// KPI: Delinquent Clients
// ---------------------------------------------------------------------------

export interface DelinquentClientsKPI {
  value: number;
  delta_abs: number;
  delta_direction: 'up' | 'down';
  compare_to: string;
}

/**
 * Get Delinquent Clients KPI
 * Fetches the count of delinquent clients for the given date and calculates
 * the simple delta compared to the same day of the previous month.
 */
export async function getDelinquentClientsKPI(
  orgId: string,
  asOf: string
): Promise<DelinquentClientsKPI> {
  const previousMonthDate = getSameDayPreviousMonth(asOf);

  // Fetch current and previous month values in parallel
  const [currentValue, previousValue] = await Promise.all([
    getMetricValue('DelinquentClientsTotal', orgId, asOf),
    getMetricValue('DelinquentClientsTotal', orgId, previousMonthDate),
  ]);

  // Simple delta: current - previous
  const deltaAbs = Math.abs(currentValue - previousValue);
  // down is good for delinquent clients (fewer is better)
  const deltaDirection: 'up' | 'down' = currentValue <= previousValue ? 'down' : 'up';

  return {
    value: currentValue,
    delta_abs: deltaAbs,
    delta_direction: deltaDirection,
    compare_to: 'previous_month',
  };
}

// ---------------------------------------------------------------------------
// KPI: Credit Utilization
// ---------------------------------------------------------------------------

export interface CreditUtilizationKPI {
  value: number;
  delta_pct: number;
  delta_direction: 'up' | 'down';
  compare_to: string;
  unit: string;
}

/**
 * Get Credit Utilization KPI
 * Fetches the credit utilization ratio for the given date and calculates
 * the delta compared to the same day of the previous month.
 */
export async function getCreditUtilizationKPI(
  orgId: string,
  asOf: string
): Promise<CreditUtilizationKPI> {
  const previousMonthDate = getSameDayPreviousMonth(asOf);

  // Fetch current and previous month values in parallel
  const [currentValue, previousValue] = await Promise.all([
    getMetricValue('CreditUsed', orgId, asOf),
    getMetricValue('CreditUsed', orgId, previousMonthDate),
  ]);

  // Delta is the difference in percentage points (ratio * 100)
  const deltaPct = Math.round((currentValue - previousValue) * 1000) / 10; // Round to 1 decimal
  // down is good for credit utilization (lower utilization is better)
  const deltaDirection: 'up' | 'down' = currentValue <= previousValue ? 'down' : 'up';

  return {
    value: currentValue,
    delta_pct: Math.abs(deltaPct),
    delta_direction: deltaDirection,
    compare_to: 'previous_month',
    unit: 'ratio',
  };
}

// ---------------------------------------------------------------------------
// Aging Buckets
// ---------------------------------------------------------------------------

export interface AgingBucket {
  range: string;
  current: number;
  overdue: number;
}

export interface AgingData {
  buckets: AgingBucket[];
}

/**
 * Calculate the date N days before the given date
 */
function getDateDaysAgo(asOf: string, days: number): Date {
  const date = new Date(asOf);
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Get aging buckets for credit notes
 * Groups credit notes by creation date into buckets:
 * - 0-30 days: created within last 30 days
 * - 31-60 days: created 31-60 days ago
 * - 61-90 days: created 61-90 days ago
 * - 90+: created more than 90 days ago
 * 
 * For each bucket:
 * - current: total amount of credit notes created in that period
 * - overdue: total pending amount (amount - paid) of overdue credit notes in that period
 */
export async function getAgingBuckets(
  orgId: string,
  asOf: string
): Promise<AgingData> {
  const asOfDate = new Date(asOf);
  
  // Date boundaries
  const thirtyDaysAgo = getDateDaysAgo(asOf, 30);
  const sixtyDaysAgo = getDateDaysAgo(asOf, 60);
  const ninetyDaysAgo = getDateDaysAgo(asOf, 90);

  // Query all credit notes for the organization
  let allCreditNotes: Array<{ amount: number; paid: number; status: string; createdAt: string }> = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await ddb.send(
      new QueryCommand({
        TableName: TABLE_CREDIT_NOTES,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :skPrefix)',
        ExpressionAttributeValues: {
          ':pk': `org#${orgId}`,
          ':skPrefix': 'creditnote#',
        },
        ProjectionExpression: 'amount, paid, #status, createdAt',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExclusiveStartKey: lastEvaluatedKey,
      })
    );

    if (result.Items) {
      allCreditNotes = allCreditNotes.concat(
        result.Items as Array<{ amount: number; paid: number; status: string; createdAt: string }>
      );
    }
    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  // Initialize buckets
  const buckets: Record<string, { current: number; overdue: number }> = {
    '0-30': { current: 0, overdue: 0 },
    '31-60': { current: 0, overdue: 0 },
    '61-90': { current: 0, overdue: 0 },
    '90+': { current: 0, overdue: 0 },
  };

  // Categorize credit notes by creation date
  for (const note of allCreditNotes) {
    const createdAt = new Date(note.createdAt);
    const amount = note.amount || 0;
    const paid = note.paid || 0;
    const pendingAmount = amount - paid;

    // Skip notes created after asOf date
    if (createdAt > asOfDate) continue;

    // Determine which bucket this note belongs to
    let bucketKey: string;
    if (createdAt >= thirtyDaysAgo) {
      bucketKey = '0-30';
    } else if (createdAt >= sixtyDaysAgo) {
      bucketKey = '31-60';
    } else if (createdAt >= ninetyDaysAgo) {
      bucketKey = '61-90';
    } else {
      bucketKey = '90+';
    }

    // Add to current total
    buckets[bucketKey].current += amount;

    // Add to overdue if status is overdue
    if (note.status === 'overdue' && pendingAmount > 0) {
      buckets[bucketKey].overdue += pendingAmount;
    }
  }

  return {
    buckets: [
      { range: '0-30', current: buckets['0-30'].current, overdue: buckets['0-30'].overdue },
      { range: '31-60', current: buckets['31-60'].current, overdue: buckets['31-60'].overdue },
      { range: '61-90', current: buckets['61-90'].current, overdue: buckets['61-90'].overdue },
      { range: '90+', current: buckets['90+'].current, overdue: buckets['90+'].overdue },
    ],
  };
}
