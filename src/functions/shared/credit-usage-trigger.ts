import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

const lambda = new LambdaClient({});

/**
 * Invoke the credit usage calculation Lambda asynchronously
 * Does not wait for response to avoid blocking the API
 */
export async function triggerCreditUsageCalculation(orgId: string): Promise<void> {
  try {
    const stage = process.env.NODE_ENV || 'dev';
    const functionName = `canaima-backend-${stage}-calculateCreditUsageEvent`;
    
    await lambda.send(
      new InvokeCommand({
        FunctionName: functionName,
        InvocationType: 'Event', // Asynchronous invocation
        Payload: JSON.stringify({
          orgId,
        }),
      }),
    );

    console.log(`Triggered credit usage calculation for org: ${orgId}`);
  } catch (error) {
    // Don't fail the main operation if credit usage calculation fails
    console.warn('Failed to trigger credit usage calculation:', error);
  }
}
