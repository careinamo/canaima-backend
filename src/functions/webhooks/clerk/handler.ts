import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { verifySvixSignature } from './verify';
import * as usersRepo from '../../users/repository';
import * as orgsRepo from '../../organizations/repository';
import { recordWebhookEvent, hasProcessedEvent } from './webhook-events';

const WEBHOOK_SECRET = process.env.CLERK_WEBHOOK_SECRET;

if (!WEBHOOK_SECRET) {
  throw new Error('CLERK_WEBHOOK_SECRET is required');
}

/**
 * Webhook handler for Clerk events
 * Verifies Svix signature and processes different event types
 */
export async function main(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  try {
    const body = event.body || '';
    const headers = Object.fromEntries(
      Object.entries(event.headers || {}).map(([k, v]) => [k.toLowerCase(), v as string]),
    );

    // Verify Svix signature
    if (!verifySvixSignature(body, headers, WEBHOOK_SECRET as string)) {
      console.warn('Invalid Svix signature');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const payload = JSON.parse(body);
    // Event ID comes from Svix header, not from payload body
    const eventId: string | undefined = headers['svix-id'];
    const eventType = payload.type;

    if (!eventId) {
      console.warn('Missing svix-id header in webhook request');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing svix-id header' }),
      };
    }

    // Check for duplicate (idempotency)
    if (await hasProcessedEvent(eventId as string)) {
      console.log(`Event ${eventId} already processed, skipping`);
      return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Event already processed' }),
      };
    }

    console.log(`Processing event: ${eventType} (${eventId})`);

    // Route to appropriate handler
    const data = payload.data;

    switch (eventType) {
      case 'user.created':
        await handleUserCreated(data);
        break;
      case 'user.updated':
        await handleUserUpdated(data);
        break;
      case 'user.deleted':
        await handleUserDeleted(data);
        break;
      case 'organization.created':
        await handleOrganizationCreated(data);
        break;
      case 'organization.updated':
        await handleOrganizationUpdated(data);
        break;
      case 'organization.deleted':
        await handleOrganizationDeleted(data);
        break;
      case 'organizationMembership.created':
        await handleMembershipCreated(data);
        break;
      case 'organizationMembership.updated':
        await handleMembershipUpdated(data);
        break;
      case 'organizationMembership.deleted':
        await handleMembershipDeleted(data);
        break;
      default:
        console.warn(`Unknown event type: ${eventType}`);
    }

    // Record processed event for idempotency
    await recordWebhookEvent(eventId);

    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Event processed' }),
    };
  } catch (error) {
    console.error('Webhook processing error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
}

// ===== Event Handlers =====

async function handleUserCreated(data: any) {
  console.log('Handling user.created:', data.id);
  await usersRepo.upsertUser({
    clerkUserId: data.id,
    email: data.email_addresses?.[0]?.email_address || '',
    firstName: data.first_name,
    lastName: data.last_name,
    imageUrl: data.image_url,
  });
}

async function handleUserUpdated(data: any) {
  console.log('Handling user.updated:', data.id);
  const user = await usersRepo.getUser(data.id);
  if (user) {
    await usersRepo.updateUserProfile(data.id, {
      firstName: data.first_name,
      lastName: data.last_name,
      imageUrl: data.image_url,
    });
  } else {
    // If user doesn't exist, create it
    await handleUserCreated(data);
  }
}

async function handleUserDeleted(data: any) {
  console.log('Handling user.deleted:', data.id);
  // Soft delete
  await usersRepo.deleteUser(data.id);
}

async function handleOrganizationCreated(data: any) {
  console.log('Handling organization.created:', data.id);
  
  // Create organization in DynamoDB from Clerk webhook data
  // This creates a basic org entry with onboardingCompleted=false
  // The user will complete onboarding via PATCH /organizations/{orgId}
  await orgsRepo.createOrgFromWebhook({
    clerkOrgId: data.id,
    name: data.name || 'Unnamed Organization',
    slug: data.slug,
    createdBy: data.created_by || 'unknown', // Clerk user ID who created the org
  });
}

async function handleOrganizationUpdated(data: any) {
  console.log('Handling organization.updated:', data.id);
  // Don't update from Clerk, only from our API
  // This prevents Clerk updates from overwriting our metadata
}

async function handleOrganizationDeleted(data: any) {
  console.log('Handling organization.deleted:', data.id);
  // Delete organization and all members
  await orgsRepo.deleteOrganizationAndMembers(data.id);
}

async function handleMembershipCreated(data: any) {
  console.log('Handling organizationMembership.created:', data.id);
  const orgId = data.organization_id;
  const userId = data.public_user_id;
  const role = data.role || 'member';

  await orgsRepo.addMember({
    clerkOrgId: orgId,
    userId,
    role,
    status: 'active',
  });
}

async function handleMembershipUpdated(data: any) {
  console.log('Handling organizationMembership.updated:', data.id);
  const orgId = data.organization_id;
  const userId = data.public_user_id;
  const newRole = data.role || 'member';

  // Update role by removing and re-adding
  await orgsRepo.removeMember(orgId, userId);
  await orgsRepo.addMember({
    clerkOrgId: orgId,
    userId,
    role: newRole,
    status: 'active',
  });
}

async function handleMembershipDeleted(data: any) {
  console.log('Handling organizationMembership.deleted:', data.id);
  const orgId = data.organization_id;
  const userId = data.public_user_id;

  await orgsRepo.removeMember(orgId, userId);
}
