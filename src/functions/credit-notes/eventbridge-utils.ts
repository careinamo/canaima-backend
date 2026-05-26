import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  DeleteRuleCommand,
  RemoveTargetsCommand,
} from '@aws-sdk/client-eventbridge';
import { LambdaClient, GetFunctionCommand } from '@aws-sdk/client-lambda';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { createHash } from 'crypto';
import { toDate, toZonedTime } from 'date-fns-tz';

const eventBridgeClient = new EventBridgeClient({});
const lambdaClient = new LambdaClient({});
const stsClient = new STSClient({});

// Get these from CloudFormation stack name or environment
const STACK_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-').slice(0, -1).join('-') || 'canaima-backend';
const STAGE = process.env.STAGE || 'dev';

// Default timezone for credit notes (Venezuela: UTC-4)
// Can be overridden per organization or in environment variables
const DEFAULT_TIMEZONE = process.env.CREDIT_NOTE_TIMEZONE || 'America/Caracas';

console.log('EventBridge Utilities initialized', { STACK_NAME, STAGE, DEFAULT_TIMEZONE });

/**
 * Generate a unique rule name for a credit note using a hash
 * EventBridge rule names have a max length of 64 characters
 * Format: cn-{32-char-md5-hash}
 * This is deterministic so we can reliably delete the rule later
 */
export function generateRuleName(orgId: string, creditNoteId: string): string {
  // Create a hash from orgId + creditNoteId
  const hash = createHash('md5')
    .update(`${orgId}-${creditNoteId}`)
    .digest('hex');
  
  // Format: cn-{hash} (total 35 chars: 3 + 32)
  return `cn-${hash}`;
}

/**
 * Create an EventBridge rule that fires at the end of a specific date
 * @param orgId Organization ID
 * @param creditNoteId Credit note ID
 * @param dueDate Date when the rule should fire (end of day in local timezone, converts to UTC)
 * @param clientId Client ID for the detail field
 * @param timezone Optional timezone (defaults to America/Caracas). Examples: 'America/Caracas', 'America/New_York'
 */
export async function createCreditNoteExpirationRule(
  orgId: string,
  creditNoteId: string,
  dueDate: string,
  clientId: string,
  timezone: string = DEFAULT_TIMEZONE,
): Promise<string> {
  const ruleName = generateRuleName(orgId, creditNoteId);

  try {
    // Parse the due date (e.g., "2025-06-30T00:00:00Z" or "2025-06-30")
    const inputDate = new Date(dueDate);
    
    // Get current time in the local timezone to check if dueDate is today
    const now = new Date();
    const nowInTimezone = toZonedTime(now, timezone);
    const dueDateInTimezone = toZonedTime(inputDate, timezone);
    
    // Compare dates (only year, month, day)
    const isToday = 
      nowInTimezone.getFullYear() === dueDateInTimezone.getFullYear() &&
      nowInTimezone.getMonth() === dueDateInTimezone.getMonth() &&
      nowInTimezone.getDate() === dueDateInTimezone.getDate();
    
    let utcDate: Date;
    
    if (isToday) {
      // If dueDate is today, fire 1 minute from now
      utcDate = new Date(now.getTime() + 60 * 1000); // Add 60 seconds
      console.log(
        `Detected dueDate is TODAY. Scheduling rule to fire 1 minute from now.`,
        `(now: ${now.toISOString()}, fireAt: ${utcDate.toISOString()})`,
      );
    } else {
      // Otherwise, fire at end of day (23:59:59) on the dueDate in the specified timezone
      const dateStr = inputDate.toISOString().split('T')[0]; // Get YYYY-MM-DD in UTC
      const endOfDayLocalStr = `${dateStr}T23:59:59`;
      
      // Convert end-of-day in local timezone to UTC
      utcDate = toDate(endOfDayLocalStr, { timeZone: timezone });
    }

    // Convert to cron expression (EventBridge uses UTC)
    // cron(minutes hours day-of-month month ? year)
    const month = (utcDate.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = utcDate.getUTCDate().toString().padStart(2, '0');
    const year = utcDate.getUTCFullYear();
    const hours = utcDate.getUTCHours().toString().padStart(2, '0');
    const minutes = utcDate.getUTCMinutes().toString().padStart(2, '0');

    const cronExpression = `cron(${minutes} ${hours} ${day} ${month} ? ${year})`;

    console.log(
      `Creating EventBridge rule: ${ruleName} with cron: ${cronExpression}`,
      `(dueDate: ${dueDate}, timezone: ${timezone}, utcTime: ${utcDate.toISOString()}, isToday: ${isToday})`,
    );

    // Create the rule
    await eventBridgeClient.send(
      new PutRuleCommand({
        Name: ruleName,
        ScheduleExpression: cronExpression,
        State: 'ENABLED',
        Description: `Credit note ${creditNoteId} expiration check for org ${orgId}`,
      }),
    );

    console.log(`Created EventBridge rule: ${ruleName}`);

    // Get Lambda function name from the current context
    // The Lambda function name follows pattern: {stackName}-processCreditNoteExpiration
    const functionName = `${STACK_NAME}-processCreditNoteExpiration`;
    
    // Get the Lambda function ARN
    const functionInfo = await lambdaClient.send(
      new GetFunctionCommand({
        FunctionName: functionName,
      }),
    );

    const lambdaArn = functionInfo.Configuration?.FunctionArn;
    if (!lambdaArn) {
      throw new Error('Could not get Lambda function ARN');
    }

    // Get account ID for role ARN
    const callerIdentity = await stsClient.send(new GetCallerIdentityCommand({}));
    const accountId = callerIdentity.Account;

    const eventBridgeRoleArn = `arn:aws:iam::${accountId}:role/${STACK_NAME}-${STAGE}-eventbridge`;

    // Add Lambda as target to the rule
    await eventBridgeClient.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [
          {
            Id: '1',
            Arn: lambdaArn,
            RoleArn: eventBridgeRoleArn,
            // Pass credit note details to the Lambda
            Input: JSON.stringify({
              creditNoteId,
              orgId,
              clientId,
            }),
          },
        ],
      }),
    );

    console.log(`Added Lambda target to rule: ${ruleName}`);

    return ruleName;
  } catch (error) {
    console.error(`Error creating EventBridge rule ${ruleName}:`, error);
    throw error;
  }
}

/**
 * Delete an EventBridge rule for a credit note
 * (useful if credit note is deleted before its due date)
 */
export async function deleteCreditNoteExpirationRule(
  orgId: string,
  creditNoteId: string,
): Promise<void> {
  const ruleName = generateRuleName(orgId, creditNoteId);

  try {
    console.log(`Deleting EventBridge rule: ${ruleName}`);

    // Remove all targets from the rule
    await eventBridgeClient.send(
      new RemoveTargetsCommand({
        Rule: ruleName,
        Ids: ['1'],
      }),
    );

    // Delete the rule
    await eventBridgeClient.send(
      new DeleteRuleCommand({
        Name: ruleName,
        Force: true,
      }),
    );

    console.log(`Deleted EventBridge rule: ${ruleName}`);
  } catch (error) {
    // Ignore errors if rule doesn't exist
    if ((error as any)?.name === 'ResourceNotFoundException') {
      console.log(`Rule ${ruleName} does not exist, skipping deletion`);
    } else {
      console.error(`Error deleting EventBridge rule ${ruleName}:`, error);
      throw error;
    }
  }
}
