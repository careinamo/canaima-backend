import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'organizations-dev';
const REGION = process.env.AWS_REGION || 'us-east-2';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const seedOrganizations = [
  {
    PK: 'ORG#org-default',
    SK: 'META',
    clerkOrgId: 'org-default',
    name: 'Default Organization',
    slug: 'default-organization',
    teamSize: 10,
    plan: 'free',
    currency: 'USD',
    createdBy: 'anonymous',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'ORG#org-acme',
    SK: 'META',
    clerkOrgId: 'org-acme',
    name: 'Acme Corporation',
    slug: 'acme-corporation',
    teamSize: 50,
    plan: 'pro',
    currency: 'USD',
    createdBy: 'user_demo',
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'ORG#org-techstart',
    SK: 'META',
    clerkOrgId: 'org-techstart',
    name: 'TechStart Industries',
    slug: 'techstart-industries',
    teamSize: 25,
    plan: 'pro',
    currency: 'USD',
    createdBy: 'user_demo2',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'ORG#org_3CEDZTEain9EFwWzrKaENHCM4Js',
    SK: 'META',
    clerkOrgId: 'org_3CEDZTEain9EFwWzrKaENHCM4Js',
    name: 'StartUp Ventures',
    slug: 'startup-ventures',
    teamSize: 15,
    plan: 'pro',
    currency: 'USD',
    createdBy: 'user_startup_ceo',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function seed() {
  try {
    console.log(`Seeding ${seedOrganizations.length} organizations to table: ${TABLE}`);

    for (const org of seedOrganizations) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: org,
        }),
      );
      console.log(`✓ Created organization: ${org.name}`);
    }

    console.log('✓ Organizations seed completed successfully');
  } catch (error) {
    console.error('✗ Error seeding organizations:', error);
    process.exit(1);
  }
}

seed();
