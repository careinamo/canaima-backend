import { formatISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

const DEFAULT_TIMEZONE = process.env.CREDIT_NOTE_TIMEZONE || 'America/Caracas';

/**
 * Get current timestamp in a specific timezone
 * Returns ISO string in UTC but represents the current time in the given timezone
 * @param timezone IANA timezone (e.g., 'America/Caracas'). Defaults to environment variable or 'America/Caracas'
 */
export function getCurrentTimestampInTimezone(timezone: string = DEFAULT_TIMEZONE): string {
  const now = new Date();
  const zonedTime = toZonedTime(now, timezone);
  return formatISO(zonedTime, { representation: 'complete' });
}

/**
 * Convert a date string to a specific timezone's representation
 * @param dateString ISO date string
 * @param timezone IANA timezone
 */
export function convertToTimezone(dateString: string, timezone: string = DEFAULT_TIMEZONE): string {
  const date = new Date(dateString);
  const zonedTime = toZonedTime(date, timezone);
  return formatISO(zonedTime, { representation: 'complete' });
}
