import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = process.env.TABLE_CLIENTS || 'clientsaaa-dev';
const REGION = process.env.AWS_REGION || 'us-east-2';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const seedClients = [
  {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Acme Corporation',
    email: 'contact@acme.com',
    nameLower: 'acme corporation',
    emailLower: 'contact@acme.com',
    phone: '+1-555-0100',
    address: '123 Business Ave, New York, NY 10001',
    status: 'active' as const,
    creditLimit: 50000,
    balance: 12500,
    notes: 'Premium client with early payment history',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440002',
    name: 'TechStart Industries',
    email: 'billing@techstart.io',
    nameLower: 'techstart industries',
    emailLower: 'billing@techstart.io',
    phone: '+1-555-0101',
    address: '456 Innovation Dr, San Francisco, CA 94105',
    status: 'active' as const,
    creditLimit: 100000,
    balance: 45300,
    lastPayment: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Growth stage startup, expanding account',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440003',
    name: 'Global Manufacturing LLC',
    email: 'procurement@globalmfg.com',
    nameLower: 'global manufacturing llc',
    emailLower: 'procurement@globalmfg.com',
    phone: '+1-555-0102',
    address: '789 Factory Lane, Detroit, MI 48201',
    status: 'overdue' as const,
    creditLimit: 75000,
    balance: 62000,
    lastPayment: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Outstanding invoice from 45 days ago',
    createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440004',
    name: 'Regional Retail Partners',
    email: 'accounts@retailpartners.com',
    nameLower: 'regional retail partners',
    emailLower: 'accounts@retailpartners.com',
    phone: '+1-555-0103',
    address: '321 Commerce St, Atlanta, GA 30303',
    status: 'inactive' as const,
    creditLimit: 30000,
    balance: 0,
    notes: 'Account inactive since Q3 2025',
    createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440005',
    name: 'Enterprise Solutions Group',
    email: 'finance@entersolutions.net',
    nameLower: 'enterprise solutions group',
    emailLower: 'finance@entersolutions.net',
    phone: '+1-555-0104',
    address: '999 Corporate Blvd, Chicago, IL 60601',
    status: 'active' as const,
    creditLimit: 250000,
    balance: 89750,
    lastPayment: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Largest account, tier-1 customer support',
    createdAt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
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
