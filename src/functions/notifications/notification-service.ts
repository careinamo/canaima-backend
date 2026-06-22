/**
 * Notification Service
 * 
 * Utility for creating notifications and broadcasting them via WebSocket.
 * This service should be used by other parts of the application when
 * they need to notify users about events.
 */

import * as notificationsRepo from './repository';
import { sendToUser } from '../websocket/send-message';
import type {
  CreateNotificationInput,
  Notification,
  WebSocketMessage,
  NotificationPayload,
} from './types';

/**
 * Get the WebSocket endpoint URL from environment variables
 */
function getWebSocketEndpoint(): string | null {
  const wsEndpoint = process.env.WEBSOCKET_ENDPOINT;
  if (!wsEndpoint) {
    console.warn('WEBSOCKET_ENDPOINT not configured, notifications will not be sent via WebSocket');
    return null;
  }
  return wsEndpoint;
}

/**
 * Create a notification and broadcast it via WebSocket
 * 
 * @param input - Notification creation input
 * @returns The created notification
 */
export async function createAndBroadcastNotification(
  input: CreateNotificationInput
): Promise<Notification> {
  // Create the notification in DynamoDB
  const notification = await notificationsRepo.createNotification(input);
  
  // Try to broadcast via WebSocket
  const endpoint = getWebSocketEndpoint();
  if (endpoint) {
    try {
      const message: WebSocketMessage<NotificationPayload> = {
        type: 'notification',
        payload: notification,
        timestamp: new Date().toISOString(),
      };
      
      const result = await sendToUser(input.userId, endpoint, message);
      console.log(`Notification broadcast result: sent=${result.sent}, failed=${result.failed}`);
    } catch (error) {
      // Don't fail the notification creation if WebSocket broadcast fails
      console.error('Error broadcasting notification via WebSocket:', error);
    }
  }

  return notification;
}

/**
 * Broadcast an existing notification via WebSocket
 * Useful when you want to re-send a notification
 */
export async function broadcastNotification(
  notification: Notification
): Promise<{ sent: number; failed: number }> {
  const endpoint = getWebSocketEndpoint();
  if (!endpoint) {
    return { sent: 0, failed: 0 };
  }

  const message: WebSocketMessage<NotificationPayload> = {
    type: 'notification',
    payload: notification,
    timestamp: new Date().toISOString(),
  };

  return sendToUser(notification.userId, endpoint, message);
}

/**
 * Broadcast a notification deletion event
 */
export async function broadcastNotificationDeleted(
  userId: string,
  notificationId: string
): Promise<{ sent: number; failed: number }> {
  const endpoint = getWebSocketEndpoint();
  if (!endpoint) {
    return { sent: 0, failed: 0 };
  }

  const message: WebSocketMessage<{ notificationId: string }> = {
    type: 'notification_deleted',
    payload: { notificationId },
    timestamp: new Date().toISOString(),
  };

  return sendToUser(userId, endpoint, message);
}

/**
 * Helper to create common notification types
 */
export const NotificationHelpers = {
  /**
   * Create a notification for credit note creation
   */
  creditNoteCreated: (
    userId: string,
    orgId: string,
    creditNoteId: string,
    clientName: string,
    amount: number,
    currency: string = 'USD'
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'credit_note_created',
    priority: 'normal',
    title: 'Nueva nota de crédito',
    message: `Se creó una nota de crédito para ${clientName} por ${currency} ${amount.toLocaleString()}`,
    link: `/orgs/${orgId}/credit-notes/${creditNoteId}`,
    resourceType: 'credit-note',
    resourceId: creditNoteId,
    metadata: { clientName, amount, currency },
  }),

  /**
   * Create a notification for credit note expiration (overdue)
   */
  creditNoteExpired: (
    userId: string,
    orgId: string,
    creditNoteId: string,
    creditNoteNumber: string,
    clientName: string,
    amount: number,
    currency: string = 'USD'
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'credit_note_expired',
    priority: 'high',
    title: 'Nota de crédito vencida',
    message: `La nota ${creditNoteNumber} de ${clientName} por ${currency} ${amount.toLocaleString()} está vencida`,
    link: `/orgs/${orgId}/credit-notes/${creditNoteId}`,
    resourceType: 'credit-note',
    resourceId: creditNoteId,
    metadata: { creditNoteNumber, clientName, amount, currency },
  }),

  /**
   * Create a notification for payment received
   */
  paymentCreated: (
    userId: string,
    orgId: string,
    paymentId: string,
    clientName: string,
    amount: number,
    currency: string = 'USD'
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'payment_created',
    priority: 'normal',
    title: 'Pago recibido',
    message: `Se recibió un pago de ${clientName} por ${currency} ${amount.toLocaleString()}`,
    link: `/orgs/${orgId}/payments/${paymentId}`,
    resourceType: 'payment',
    resourceId: paymentId,
    metadata: { clientName, amount, currency },
  }),

  /**
   * Create a notification for credit note fully paid
   */
  creditNotePaid: (
    userId: string,
    orgId: string,
    creditNoteId: string,
    creditNoteNumber: string,
    clientName: string,
    amount: number,
    currency: string = 'USD'
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'credit_note_paid',
    priority: 'normal',
    title: 'Nota de crédito pagada',
    message: `${clientName} pagó completamente la nota ${creditNoteNumber} (${currency} ${amount.toLocaleString()})`,
    link: `/orgs/${orgId}/credit-notes/${creditNoteId}`,
    resourceType: 'credit-note',
    resourceId: creditNoteId,
    metadata: { creditNoteNumber, clientName, amount, currency },
  }),

  /**
   * Create a notification for client marked as delinquent
   */
  clientDelinquent: (
    userId: string,
    orgId: string,
    clientId: string,
    clientName: string
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'client_delinquent',
    priority: 'high',
    title: 'Cliente moroso',
    message: `${clientName} ha sido marcado como moroso debido a notas de crédito vencidas`,
    link: `/orgs/${orgId}/clients/${clientId}`,
    resourceType: 'client',
    resourceId: clientId,
    metadata: { clientName },
  }),

  /**
   * Create a notification when a report is ready
   */
  reportReady: (
    userId: string,
    orgId: string,
    reportType: string,
    downloadUrl: string
  ): CreateNotificationInput => ({
    userId,
    orgId,
    type: 'report_ready',
    priority: 'normal',
    title: 'Reporte listo',
    message: `Tu reporte de ${reportType} está listo para descargar`,
    link: downloadUrl,
    resourceType: 'report',
    metadata: { reportType },
    // Reports expire after 7 days
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }),

  /**
   * Create a system notification
   */
  system: (
    userId: string,
    title: string,
    message: string,
    link?: string
  ): CreateNotificationInput => ({
    userId,
    type: 'system',
    priority: 'normal',
    title,
    message,
    link,
  }),
};
