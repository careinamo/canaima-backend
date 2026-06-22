/**
 * Publish CRUD events to EventBridge
 * These are granular events fired on any data change
 * Allows multiple downstream processors to react to the same event
 */

import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Create client inside function to avoid signature expiration on frozen Lambdas
function getEventBridgeClient() {
  return new EventBridgeClient({});
}

export type CrudEventType = 
  | 'CreditNoteCreated'
  | 'CreditNoteUpdated'
  | 'CreditNoteDeleted'
  | 'CreditNotePaid'
  | 'PaymentCreated'
  | 'PaymentUpdated'
  | 'PaymentDeleted'
  | 'ClientCreated'
  | 'ClientUpdated'
  | 'ClientDeleted';

/**
 * Publish a CRUD event to EventBridge
 * @param eventType Type of CRUD event
 * @param orgId Organization ID
 * @param entityId ID of the entity being created/updated/deleted
 * @param entityData Full entity data for downstream processors
 * @param actorUserId Optional: ID of the user who performed the action
 */
export async function publishCrudEvent(
  eventType: CrudEventType,
  orgId: string,
  entityId: string,
  entityData?: unknown,
  actorUserId?: string,
): Promise<void> {
  try {
    const params = {
      Entries: [
        {
          Source: 'canaima.crud',
          DetailType: eventType,
          Detail: JSON.stringify({
            type: eventType,
            orgId,
            entityId,
            data: entityData,
            actorUserId,
            timestamp: new Date().toISOString(),
          }),
          EventBusName: 'default',
        },
      ],
    };

    const eventBridge = getEventBridgeClient();
    const response = await eventBridge.send(new PutEventsCommand(params));

    if (response.FailedEntryCount && response.FailedEntryCount > 0) {
      console.error(`Failed to publish CRUD event (${eventType}):`, response.Entries);
      throw new Error(
        `Failed to publish CRUD event: ${response.FailedEntryCount} entries failed`,
      );
    }

    console.log(`Published ${eventType} event for entity ${entityId} in org ${orgId}`);
  } catch (error) {
    console.error(`Error publishing CRUD event (${eventType}):`, error);
    throw error;
  }
}
