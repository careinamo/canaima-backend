/**
 * Utility to publish metrics calculation events to EventBridge
 * Used by both credit usage and credit notes metrics calculations
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Create client inside function to avoid signature expiration on frozen Lambdas
function getEventBridgeClient() {
  return new EventBridgeClient({});
}

export async function publishMetricsEvent(
  eventType: 'CreditUsageCalculationRequested' | 'CreditNoteMetricsUpdateRequested',
  orgId: string,
): Promise<void> {
  const now = new Date();

  const params = {
    Entries: [
      {
        Source: 'canaima.metrics',
        DetailType: eventType,
        Detail: JSON.stringify({
          type: eventType,
          orgId,
          timestamp: now.toISOString(),
        }),
        EventBusName: 'default',
      },
    ],
  };

  try {
    const eventBridge = getEventBridgeClient();
    const response = await eventBridge.send(new PutEventsCommand(params));

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.error('Failed to publish metrics event:', response.Entries);
      throw new Error(`Failed to publish metrics event: ${response.FailedEntryCount} entries failed`);
    }

    console.log(`Published metrics event: ${eventType} for org ${orgId}`);
  } catch (error) {
    console.error(`Error publishing metrics event (${eventType}):`, error);
    throw error;
  }
}
