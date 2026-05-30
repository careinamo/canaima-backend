/**
 * Publish credit notes-related events to EventBridge
 * Used for triggering downstream processes like client delinquency checks
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { getCurrentTimestampInTimezone } from './timezone-utils';

const eventBridge = new EventBridgeClient({});

export type CreditNoteEventType = 'CreditNoteDeletedEvent';

/**
 * Publish a credit notes event to EventBridge
 * Currently supports:
 * - CreditNoteDeletedEvent: Triggers client delinquency re-validation
 */
export async function publishCreditNoteEvent(
  eventType: CreditNoteEventType,
  orgId: string,
  clientId: string,
  creditNoteId?: string,
): Promise<void> {
  try {
    const now = getCurrentTimestampInTimezone();

    const params = {
      Entries: [
        {
          Source: 'canaima.credit-notes',
          DetailType: eventType,
          Detail: JSON.stringify({
            type: eventType,
            orgId,
            clientId,
            creditNoteId,
            timestamp: now,
          }),
          EventBusName: 'default',
        },
      ],
    };

    const response = await eventBridge.send(new PutEventsCommand(params));

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.error(`Failed to publish credit note event (${eventType}):`, response.Entries);
      throw new Error(
        `Failed to publish credit note event: ${response.FailedEntryCount} entries failed`,
      );
    }

    console.log(`Published ${eventType} event for client ${clientId} in org ${orgId}`);
  } catch (error) {
    console.error(`Error publishing credit note event (${eventType}):`, error);
    throw error;
  }
}
