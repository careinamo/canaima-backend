import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'credit-notes-dev';
const REGION = process.env.AWS_REGION || 'us-east-2';
const ORG_ID = process.env.SEED_ORG_ID || 'org-default';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

// Client IDs from clients.ts seed
const CLIENT_IDS = {
  acme: '550e8400-e29b-41d4-a716-446655440001',
  techstart: '550e8400-e29b-41d4-a716-446655440002',
  globalMfg: '550e8400-e29b-41d4-a716-446655440003',
  regionalRetail: '550e8400-e29b-41d4-a716-446655440004',
  enterprise: '550e8400-e29b-41d4-a716-446655440005',
};

const CLIENT_NAMES = {
  acme: 'Acme Corporation',
  techstart: 'TechStart Industries',
  globalMfg: 'Global Manufacturing LLC',
  regionalRetail: 'Regional Retail Partners',
  enterprise: 'Enterprise Solutions Group',
};

const seedCreditNotes = [
  {
    id: '660e8400-e29b-41d4-a716-446655550001',
    number: 'NC-001',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550001',
    clientId: CLIENT_IDS.acme,
    clientIdGSI: CLIENT_IDS.acme,
    clientName: CLIENT_NAMES.acme,
    invoiceNumber: 'INV-2024-001',
    amount: 5000,
    status: 'pending' as const,
    statusGSI: 'pending' as const,
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Credit for returned goods',
    numberLower: 'nc-001',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '660e8400-e29b-41d4-a716-446655550002',
    number: 'NC-002',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550002',
    clientId: CLIENT_IDS.acme,
    clientIdGSI: CLIENT_IDS.acme,
    clientName: CLIENT_NAMES.acme,
    invoiceNumber: 'INV-2024-015',
    amount: 2500,
    status: 'paid' as const,
    statusGSI: 'paid' as const,
    dueDate: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Early payment discount',
    numberLower: 'nc-002',
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '660e8400-e29b-41d4-a716-446655550003',
    number: 'NC-003',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550003',
    clientId: CLIENT_IDS.techstart,
    clientIdGSI: CLIENT_IDS.techstart,
    clientName: CLIENT_NAMES.techstart,
    invoiceNumber: 'INV-2024-032',
    amount: 8750,
    status: 'partial' as const,
    statusGSI: 'partial' as const,
    dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Partial credit for service issues',
    numberLower: 'nc-003',
    createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '660e8400-e29b-41d4-a716-446655550004',
    number: 'NC-004',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550004',
    clientId: CLIENT_IDS.globalMfg,
    clientIdGSI: CLIENT_IDS.globalMfg,
    clientName: CLIENT_NAMES.globalMfg,
    invoiceNumber: 'INV-2024-048',
    amount: 12000,
    status: 'pending' as const,
    statusGSI: 'pending' as const,
    dueDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Quality adjustment credit',
    numberLower: 'nc-004',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '660e8400-e29b-41d4-a716-446655550005',
    number: 'NC-005',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550005',
    clientId: CLIENT_IDS.globalMfg,
    clientIdGSI: CLIENT_IDS.globalMfg,
    clientName: CLIENT_NAMES.globalMfg,
    invoiceNumber: 'INV-2024-052',
    amount: 3500,
    status: 'paid' as const,
    statusGSI: 'paid' as const,
    dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Promotional allowance',
    numberLower: 'nc-005',
    createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '660e8400-e29b-41d4-a716-446655550006',
    number: 'NC-006',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'creditnote#660e8400-e29b-41d4-a716-446655550006',
    clientId: CLIENT_IDS.enterprise,
    clientIdGSI: CLIENT_IDS.enterprise,
    clientName: CLIENT_NAMES.enterprise,
    invoiceNumber: 'INV-2024-061',
    amount: 15000,
    status: 'partial' as const,
    statusGSI: 'partial' as const,
    dueDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
    description: 'Volume discount credit for Q2',
    numberLower: 'nc-006',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function seed() {
  try {
    console.log(`Seeding credit notes into table: ${TABLE}`);
    console.log(`Organization: ${ORG_ID}\n`);

    for (const note of seedCreditNotes) {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: note }));
      console.log(`✓ Created: ${note.number} - ${note.clientName} (Status: ${note.status}, Amount: $${note.amount})`);
    }

    console.log(`\n✓ Seed completed successfully! ${seedCreditNotes.length} credit notes inserted.`);
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

seed();
