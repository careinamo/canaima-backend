/**
 * Notification Event Handler
 * 
 * Processes CRUD events from EventBridge via SNS and creates notifications.
 * This enables a decoupled architecture where notifications are created
 * asynchronously after CRUD operations complete.
 * 
 * Flow: CRUD Operation → EventBridge → SNS Topic → This Lambda → Create Notification → WebSocket Broadcast
 */

import type { SNSEvent, SNSHandler } from 'aws-lambda';
import { createAndBroadcastNotification } from './notification-service';
import type { CreateNotificationInput, NotificationType, NotificationPriority } from './types';

// Event detail structure from EventBridge
interface CrudEventDetail {
  type: string;
  orgId: string;
  entityId: string;
  data?: Record<string, unknown>;
  actorUserId?: string;
  timestamp: string;
}

// EventBridge event wrapped in SNS message
interface EventBridgeEvent {
  version: string;
  id: string;
  'detail-type': string;
  source: string;
  account: string;
  time: string;
  region: string;
  detail: CrudEventDetail;
}

/**
 * Map CRUD event types to notification configuration
 */
const EVENT_NOTIFICATION_MAP: Record<string, {
  type: NotificationType;
  priority: NotificationPriority;
  titleTemplate: (data: CrudEventDetail) => string;
  messageTemplate: (data: CrudEventDetail) => string;
  resourceType: string;
  linkTemplate?: (data: CrudEventDetail) => string;
}> = {
  // Credit Note events
  CreditNoteCreated: {
    type: 'credit_note_created',
    priority: 'normal',
    titleTemplate: () => 'Nueva nota de crédito',
    messageTemplate: (d) => {
      const clientName = (d.data?.clientName as string) || 'un cliente';
      const amount = d.data?.amount ? `$${d.data.amount}` : '';
      return `Se creó una nota de crédito${amount ? ` por ${amount}` : ''} para ${clientName}`;
    },
    resourceType: 'credit-note',
    linkTemplate: (d) => `/orgs/${d.orgId}/credit-notes/${d.entityId}`,
  },
  CreditNoteUpdated: {
    type: 'credit_note_updated',
    priority: 'low',
    titleTemplate: () => 'Nota de crédito actualizada',
    messageTemplate: (d) => {
      const number = (d.data?.number as string) || '';
      return `Se actualizó la nota de crédito${number ? ` #${number}` : ''}`;
    },
    resourceType: 'credit-note',
    linkTemplate: (d) => `/orgs/${d.orgId}/credit-notes/${d.entityId}`,
  },
  CreditNoteDeleted: {
    type: 'credit_note_deleted',
    priority: 'normal',
    titleTemplate: () => 'Nota de crédito eliminada',
    messageTemplate: () => 'Se eliminó una nota de crédito',
    resourceType: 'credit-note',
  },
  CreditNotePaid: {
    type: 'credit_note_paid',
    priority: 'high',
    titleTemplate: () => 'Nota de crédito pagada',
    messageTemplate: (d) => {
      const number = (d.data?.creditNoteNumber as string) || '';
      return `Se marcó como pagada la nota de crédito${number ? ` #${number}` : ''}`;
    },
    resourceType: 'credit-note',
    linkTemplate: (d) => `/orgs/${d.orgId}/credit-notes/${(d.data?.creditNoteId as string) || d.entityId}`,
  },

  // Payment events
  PaymentCreated: {
    type: 'payment_created',
    priority: 'normal',
    titleTemplate: () => 'Nuevo pago registrado',
    messageTemplate: (d) => {
      const amount = d.data?.amount ? `$${d.data.amount}` : '';
      return `Se registró un nuevo pago${amount ? ` por ${amount}` : ''}`;
    },
    resourceType: 'payment',
    linkTemplate: (d) => `/orgs/${d.orgId}/payments/${d.entityId}`,
  },
  PaymentUpdated: {
    type: 'payment_updated',
    priority: 'low',
    titleTemplate: () => 'Pago actualizado',
    messageTemplate: () => 'Se actualizó un pago',
    resourceType: 'payment',
    linkTemplate: (d) => `/orgs/${d.orgId}/payments/${d.entityId}`,
  },
  PaymentDeleted: {
    type: 'payment_deleted',
    priority: 'normal',
    titleTemplate: () => 'Pago eliminado',
    messageTemplate: () => 'Se eliminó un pago',
    resourceType: 'payment',
  },

  // Client events
  ClientCreated: {
    type: 'client_created',
    priority: 'normal',
    titleTemplate: () => 'Nuevo cliente',
    messageTemplate: (d) => {
      const name = (d.data?.name as string) || 'Sin nombre';
      return `Se creó el cliente "${name}"`;
    },
    resourceType: 'client',
    linkTemplate: (d) => `/orgs/${d.orgId}/clients/${d.entityId}`,
  },
  ClientUpdated: {
    type: 'client_updated',
    priority: 'low',
    titleTemplate: () => 'Cliente actualizado',
    messageTemplate: (d) => {
      const name = (d.data?.name as string) || '';
      return `Se actualizó el cliente${name ? ` "${name}"` : ''}`;
    },
    resourceType: 'client',
    linkTemplate: (d) => `/orgs/${d.orgId}/clients/${d.entityId}`,
  },
  ClientDeleted: {
    type: 'client_deleted',
    priority: 'normal',
    titleTemplate: () => 'Cliente eliminado',
    messageTemplate: () => 'Se eliminó un cliente',
    resourceType: 'client',
  },
};

/**
 * Process a single EventBridge event and create notification
 */
async function processEvent(event: EventBridgeEvent): Promise<void> {
  const eventType = event['detail-type'];
  const detail = event.detail;

  console.log(`Processing ${eventType} event:`, JSON.stringify(detail));

  // Get notification config for this event type
  const config = EVENT_NOTIFICATION_MAP[eventType];
  if (!config) {
    console.log(`No notification config for event type: ${eventType}, skipping`);
    return;
  }

  // Must have actorUserId to create notification
  if (!detail.actorUserId) {
    console.log(`No actorUserId in event, skipping notification for ${eventType}`);
    return;
  }

  // Build notification input
  const notificationInput: CreateNotificationInput = {
    userId: detail.actorUserId,
    orgId: detail.orgId,
    type: config.type,
    priority: config.priority,
    title: config.titleTemplate(detail),
    message: config.messageTemplate(detail),
    resourceType: config.resourceType,
    resourceId: detail.entityId,
    link: config.linkTemplate?.(detail),
    metadata: {
      eventType,
      eventId: event.id,
      eventTime: event.time,
      entityData: detail.data,
    },
  };

  console.log('Creating notification:', JSON.stringify(notificationInput));

  try {
    const notification = await createAndBroadcastNotification(notificationInput);
    console.log(`Created notification ${notification.id} for user ${detail.actorUserId}`);
  } catch (error) {
    console.error('Failed to create notification:', error);
    throw error; // Re-throw to let SNS retry
  }
}

/**
 * Lambda handler for SNS events
 * Processes CRUD events and creates notifications
 */
export const handler: SNSHandler = async (event: SNSEvent): Promise<void> => {
  console.log('Received SNS event:', JSON.stringify(event));

  const results = await Promise.allSettled(
    event.Records.map(async (record) => {
      try {
        // Parse the EventBridge event from SNS message
        const eventBridgeEvent: EventBridgeEvent = JSON.parse(record.Sns.Message);
        await processEvent(eventBridgeEvent);
      } catch (error) {
        console.error('Error processing SNS record:', error);
        throw error;
      }
    })
  );

  // Log results
  const succeeded = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  console.log(`Processed ${succeeded} events successfully, ${failed} failed`);

  // If any failed, throw to trigger SNS retry
  if (failed > 0) {
    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => r.reason);
    throw new Error(`Failed to process ${failed} events: ${errors.join(', ')}`);
  }
};
