import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'clients-dev';
const REGION = process.env.AWS_REGION || 'us-east-2';
const ORG_ID = process.env.SEED_ORG_ID || 'org-default';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const seedClients = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440001',
    name: 'Acme Corporation',
    email: 'contact@acme.com',
    nameLower: 'acme corporation',
    emailLower: 'contact@acme.com',
    phone: '+1-555-0100',
    address: '123 Business Ave, New York, NY 10001',
    active: true,
    delinquent: false,
    creditLimit: 50000,
    accumulatedDebt: 12500,
    notes: 'Premium client with early payment history',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440002',
    name: 'TechStart Industries',
    email: 'billing@techstart.io',
    nameLower: 'techstart industries',
    emailLower: 'billing@techstart.io',
    phone: '+1-555-0101',
    address: '456 Innovation Dr, San Francisco, CA 94105',
    active: true,
    delinquent: false,
    creditLimit: 100000,
    accumulatedDebt: 45300,
    lastPayment: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Growth stage startup, expanding account',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440003',
    name: 'Global Manufacturing LLC',
    email: 'procurement@globalmfg.com',
    nameLower: 'global manufacturing llc',
    emailLower: 'procurement@globalmfg.com',
    phone: '+1-555-0102',
    address: '789 Factory Lane, Detroit, MI 48201',
    active: true,
    delinquent: true,
    creditLimit: 75000,
    accumulatedDebt: 62000,
    lastPayment: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Outstanding invoice from 45 days ago',
    createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440004',
    name: 'Regional Retail Partners',
    email: 'accounts@retailpartners.com',
    nameLower: 'regional retail partners',
    emailLower: 'accounts@retailpartners.com',
    phone: '+1-555-0103',
    address: '321 Commerce St, Atlanta, GA 30303',
    active: false,
    delinquent: false,
    creditLimit: 30000,
    accumulatedDebt: 0,
    notes: 'Account inactive since Q3 2025',
    createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440005',
    name: 'Enterprise Solutions Group',
    email: 'finance@entersolutions.net',
    nameLower: 'enterprise solutions group',
    emailLower: 'finance@entersolutions.net',
    phone: '+1-555-0104',
    address: '999 Corporate Blvd, Chicago, IL 60601',
    active: true,
    delinquent: false,
    creditLimit: 250000,
    accumulatedDebt: 89750,
    lastPayment: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Largest account, tier-1 customer support',
    createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440006',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'client#550e8400-e29b-41d4-a716-446655440006',
    name: 'Digital Marketing Co',
    email: 'hello@digitalmarketingco.com',
    nameLower: 'digital marketing co',
    emailLower: 'hello@digitalmarketingco.com',
    phone: '+1-555-0105',
    address: '654 Media Way, Los Angeles, CA 90001',
    active: true,
    delinquent: false,
    creditLimit: 45000,
    accumulatedDebt: 18500,
    lastPayment: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'New client, good payment record',
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440007',
    orgId: 'org_3CEDZTEain9EFwWzrKaENHCM4Js',
    PK: 'org#org_3CEDZTEain9EFwWzrKaENHCM4Js',
    SK: 'client#550e8400-e29b-41d4-a716-446655440007',
    name: 'StartUp Ventures Inc',
    email: 'contact@startupventures.com',
    nameLower: 'startup ventures inc',
    emailLower: 'contact@startupventures.com',
    phone: '+1-555-0106',
    address: '987 Innovation Park, Austin, TX 78701',
    active: true,
    delinquent: false,
    creditLimit: 60000,
    accumulatedDebt: 0,
    notes: 'New client without any credit notes or payments yet',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function seed() {
  try {
    console.log(`Seeding clients into table: ${TABLE}`);

    for (const client of seedClients) {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: client }));
      console.log(`✓ Created: ${client.name} (${client.email})`);
    }

    console.log(`\n✓ Seed completed successfully! ${seedClients.length} clients inserted.`);
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

seed();
