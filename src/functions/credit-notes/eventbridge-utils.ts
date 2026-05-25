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

const eventBridgeClient = new EventBridgeClient({});
const lambdaClient = new LambdaClient({});
const stsClient = new STSClient({});

// Get these from CloudFormation stack name or environment
const STACK_NAME = process.env.AWS_LAMBDA_FUNCTION_NAME?.split('-').slice(0, -1).join('-') || 'canaima-backend';
const STAGE = process.env.STAGE || 'dev';

console.log('EventBridge Utilities initialized', { STACK_NAME, STAGE });

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
