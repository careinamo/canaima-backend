import { EventBridgeEvent } from 'aws-lambda';
import * as repo from './repository';

console.log('Credit Note Expiration Handler initialized');

export interface CreditNoteExpirationPayload {
  creditNoteId: string;
  orgId: string;
  clientId: string;
}

/**
 * EventBridge-triggered handler for credit note expiration
 * Each credit note has its own EventBridge rule that fires at end of dueDate
 * 
 * Checks if credit note is paid:
 * - If paid === amount → status = 'paid'
 * - If paid < amount → status = 'overdue', mark client as delinquent
 */
export async function processCreditNoteExpiration(
  event: EventBridgeEvent<'Credit Note Expiration', CreditNoteExpirationPayload>,
): Promise<{
  statusCode: number;
  body: string;
}> {
  try {
    const { creditNoteId, orgId, clientId } = event.detail;

    console.log(
      `Processing credit note expiration: ${creditNoteId} for org ${orgId}, client ${clientId}`,
    );

    const result = await repo.processCreditNoteExpiration(creditNoteId, orgId, clientId);

    console.log(`Credit note ${creditNoteId} processed:`, result);

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Credit note expiration processed',
        result,
      }),
    };
  } catch (error) {
    console.error('Error in credit note expiration handler:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
}
