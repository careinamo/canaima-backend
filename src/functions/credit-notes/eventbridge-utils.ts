import {
  EventBridgeClient,
  PutRuleCommand,
  PutTargetsCommand,
  DeleteRuleCommand,
  RemoveTargetsCommand,
} from '@aws-sdk/client-eventbridge';
import { LambdaClient, GetFunctionCommand } from '@aws-sdk/client-lambda';

const eventBridgeClient = new EventBridgeClient({});
const lambdaClient = new LambdaClient({});

const FUNCTION_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME as string;

console.log('EventBridge Utilities initialized', { FUNCTION_NAME });

/**
 * Generate a unique rule name for a credit note
 * Format: credit-note-{orgId}-{creditNoteId}
 */
export function generateRuleName(orgId: string, creditNoteId: string): string {
  // Replace non-alphanumeric with hyphens to comply with EventBridge naming rules
  return `credit-note-${orgId}-${creditNoteId}`.toLowerCase().replace(/[^a-z0-9-]/g, '-');
}

/**
 * Create an EventBridge rule that fires at the end of a specific date
 * @param orgId Organization ID
 * @param creditNoteId Credit note ID
 * @param dueDate Date when the rule should fire (end of day 23:59:59 UTC)
 * @param clientId Client ID for the detail field
 */
export async function createCreditNoteExpirationRule(
  orgId: string,
  creditNoteId: string,
  dueDate: string,
  clientId: string,
): Promise<string> {
  const ruleName = generateRuleName(orgId, creditNoteId);

  try {
    // Parse the due date and set to end of day (23:59:59 UTC)
    const date = new Date(dueDate);
    date.setUTCHours(23, 59, 59, 999);

    // Convert to cron expression
    // cron(minutes hours day-of-month month ? year)
    const month = (date.getUTCMonth() + 1).toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const year = date.getUTCFullYear();

    const cronExpression = `cron(59 23 ${day} ${month} ? ${year})`;

    console.log(
      `Creating EventBridge rule: ${ruleName} with cron: ${cronExpression} (${dueDate})`,
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

    // Get the Lambda function ARN
    const functionInfo = await lambdaClient.send(
      new GetFunctionCommand({
        FunctionName: FUNCTION_NAME,
      }),
    );

    const lambdaArn = functionInfo.Configuration?.FunctionArn;
    if (!lambdaArn) {
      throw new Error('Could not get Lambda function ARN');
    }

    // Add Lambda as target to the rule
    await eventBridgeClient.send(
      new PutTargetsCommand({
        Rule: ruleName,
        Targets: [
          {
            Id: '1',
            Arn: lambdaArn,
            RoleArn: process.env.EVENTBRIDGE_ROLE_ARN,
            DeadLetterConfig: {
              Arn: process.env.EVENTBRIDGE_DLQ_ARN,
            },
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
