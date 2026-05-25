import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { CreditNoteStatus } from '../types';

const TABLE_CREDIT_NOTES = process.env.TABLE_CREDIT_NOTES as string;
const TABLE_CLIENTS = process.env.TABLE_CLIENTS as string;

console.log('Credit Note Expiration Repository initialized');

if (!TABLE_CREDIT_NOTES || !TABLE_CLIENTS) {
  console.error('ERROR: TABLE_CREDIT_NOTES or TABLE_CLIENTS environment variables are not set!');
}

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export interface ExpirationResult {
  creditNoteId: string;
  previousStatus: string;
  newStatus: CreditNoteStatus;
  clientMarkedDelinquent: boolean;
  paid: number;
  amount: number;
}

/**
 * Process expiration for a specific credit note
 * Called when EventBridge rule fires at end of dueDate
 */
export async function processCreditNoteExpiration(
  creditNoteId: string,
  orgId: string,
  clientId: string,
): Promise<ExpirationResult> {
  try {
    // Get the credit note
    const creditNoteResult = await ddb.send(
      new GetCommand({
        TableName: TABLE_CREDIT_NOTES,
        Key: {
          PK: `org#${orgId}`,
          SK: `creditnote#${creditNoteId}`,
        },
      }),
    );

    if (!creditNoteResult.Item) {
      throw new Error(`Credit note ${creditNoteId} not found`);
    }

    const creditNote = creditNoteResult.Item;
    const previousStatus = creditNote.status;

    // Check if already processed
    if (creditNote.status === 'paid' || creditNote.status === 'overdue') {
      console.log(
        `Credit note ${creditNoteId} already has status ${creditNote.status}, skipping processing`,
      );
      return {
        creditNoteId,
        previousStatus,
        newStatus: creditNote.status,
        clientMarkedDelinquent: false,
        paid: creditNote.paid,
        amount: creditNote.amount,
      };
    }

    // Determine new status based on payment
    const newStatus: CreditNoteStatus = creditNote.paid === creditNote.amount ? 'paid' : 'overdue';
    let clientMarkedDelinquent = false;

    // Update credit note status
    await ddb.send(
      new UpdateCommand({
        TableName: TABLE_CREDIT_NOTES,
        Key: {
          PK: `org#${orgId}`,
          SK: `creditnote#${creditNoteId}`,
        },
        UpdateExpression: 'SET #status = :status, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':status': newStatus,
          ':updatedAt': new Date().toISOString(),
        },
      }),
    );

    console.log(`Updated credit note ${creditNoteId} status to: ${newStatus}`);

    // If overdue, mark client as delinquent
    if (newStatus === 'overdue') {
      await ddb.send(
        new UpdateCommand({
          TableName: TABLE_CLIENTS,
          Key: {
            PK: `org#${orgId}`,
            SK: `client#${clientId}`,
          },
          UpdateExpression: 'SET #delinquent = :delinquent, #updatedAt = :updatedAt',
          ExpressionAttributeNames: {
            '#delinquent': 'delinquent',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':delinquent': true,
            ':updatedAt': new Date().toISOString(),
          },
        }),
      );

      clientMarkedDelinquent = true;
      console.log(`Marked client ${clientId} as delinquent`);
    }

    return {
      creditNoteId,
      previousStatus,
      newStatus,
      clientMarkedDelinquent,
      paid: creditNote.paid,
      amount: creditNote.amount,
    };
  } catch (error) {
    console.error(`Error processing credit note expiration for ${creditNoteId}:`, error);
    throw error;
  }
}
