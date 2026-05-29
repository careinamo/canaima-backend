import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

const eventBridge = new EventBridgeClient({});

/**
 * Publish credit usage calculation event to EventBridge
 * EventBridge will route to SQS, which will trigger the processing Lambda
 * Does not wait for response to avoid blocking the API
 */
export async function triggerCreditUsageCalculation(orgId: string): Promise<void> {
  try {
    const eventBusName = 'default';
    const eventSource = 'canaima.creditusage';
    const detailType = 'CreditUsageCalculationRequested';

    await eventBridge.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: eventSource,
            DetailType: detailType,
            EventBusName: eventBusName,
            Detail: JSON.stringify({
              orgId,
              timestamp: new Date().toISOString(),
            }),
          },
        ],
      }),
    );

    console.log(`Published credit usage calculation event for org: ${orgId}`);
  } catch (error) {
    // Don't fail the main operation if event publishing fails
    console.warn('Failed to publish credit usage calculation event:', error);
  }
}
