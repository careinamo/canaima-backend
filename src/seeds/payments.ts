import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'payments-dev';
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
  enterprise: '550e8400-e29b-41d4-a716-446655440005',
};

const CLIENT_NAMES = {
  acme: 'Acme Corporation',
  techstart: 'TechStart Industries',
  globalMfg: 'Global Manufacturing LLC',
  enterprise: 'Enterprise Solutions Group',
};

// Credit Note IDs from credit-notes.ts seed
const CREDIT_NOTE_IDS = {
  nc001: '660e8400-e29b-41d4-a716-446655550001',
  nc002: '660e8400-e29b-41d4-a716-446655550002',
  nc003: '660e8400-e29b-41d4-a716-446655550003',
  nc004: '660e8400-e29b-41d4-a716-446655550004',
  nc005: '660e8400-e29b-41d4-a716-446655550005',
  nc006: '660e8400-e29b-41d4-a716-446655550006',
};

const seedPayments = [
  {
    id: '770e8400-e29b-41d4-a716-446655660001',
    number: 'AB-001',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660001',
    clientId: CLIENT_IDS.acme,
    clientIdGSI: CLIENT_IDS.acme,
    clientName: CLIENT_NAMES.acme,
    creditNoteId: CREDIT_NOTE_IDS.nc001,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc001,
    invoiceNumber: 'FAC-2024-001',
    amount: 5000,
    method: 'bank_transfer' as const,
    methodGSI: 'bank_transfer' as const,
    status: 'confirmed' as const,
    statusGSI: 'confirmed' as const,
    bankName: 'Banco Provincial',
    reference: 'REF-89012',
    description: 'Abono factura abril',
    clientAccumulatedDebtAtRecord: 2500,
    clientCreditLimitAtRecord: 50000,
    numberLower: 'ab-001',
    createdAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '770e8400-e29b-41d4-a716-446655660002',
    number: 'AB-002',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660002',
    clientId: CLIENT_IDS.acme,
    clientIdGSI: CLIENT_IDS.acme,
    clientName: CLIENT_NAMES.acme,
    creditNoteId: CREDIT_NOTE_IDS.nc002,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc002,
    invoiceNumber: 'FAC-2024-002',
    amount: 2500,
    method: 'cash' as const,
    methodGSI: 'cash' as const,
    status: 'confirmed' as const,
    statusGSI: 'confirmed' as const,
    description: 'Efectivo recibido en sucursal',
    clientAccumulatedDebtAtRecord: 0,
    clientCreditLimitAtRecord: 50000,
    numberLower: 'ab-002',
    createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '770e8400-e29b-41d4-a716-446655660003',
    number: 'AB-003',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660003',
    clientId: CLIENT_IDS.techstart,
    clientIdGSI: CLIENT_IDS.techstart,
    clientName: CLIENT_NAMES.techstart,
    creditNoteId: CREDIT_NOTE_IDS.nc003,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc003,
    invoiceNumber: 'FAC-2024-015',
    amount: 8750,
    method: 'mobile_payment' as const,
    methodGSI: 'mobile_payment' as const,
    status: 'pending' as const,
    statusGSI: 'pending' as const,
    bankName: 'Banesco',
    reference: 'MOV-456789',
    description: 'Transferencia mobile pending',
    clientAccumulatedDebtAtRecord: 0,
    clientCreditLimitAtRecord: 100000,
    numberLower: 'ab-003',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '770e8400-e29b-41d4-a716-446655660004',
    number: 'AB-004',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660004',
    clientId: CLIENT_IDS.globalMfg,
    clientIdGSI: CLIENT_IDS.globalMfg,
    clientName: CLIENT_NAMES.globalMfg,
    creditNoteId: CREDIT_NOTE_IDS.nc004,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc004,
    invoiceNumber: 'FAC-2024-048',
    amount: 12000,
    method: 'credit_card' as const,
    methodGSI: 'credit_card' as const,
    status: 'confirmed' as const,
    statusGSI: 'confirmed' as const,
    reference: 'CC-***1234',
    description: 'Pago con tarjeta crédito',
    clientAccumulatedDebtAtRecord: 3500,
    clientCreditLimitAtRecord: 75000,
    numberLower: 'ab-004',
    createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: '770e8400-e29b-41d4-a716-446655660005',
    number: 'AB-005',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660005',
    clientId: CLIENT_IDS.globalMfg,
    clientIdGSI: CLIENT_IDS.globalMfg,
    clientName: CLIENT_NAMES.globalMfg,
    creditNoteId: CREDIT_NOTE_IDS.nc005,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc005,
    invoiceNumber: 'FAC-2024-052',
    amount: 3500,
    method: 'bank_transfer' as const,
    methodGSI: 'bank_transfer' as const,
    status: 'rejected' as const,
    statusGSI: 'rejected' as const,
    bankName: 'Banco Mercantil',
    reference: 'REF-REJECTED-123',
    description: 'Transferencia rechazada - cuenta no disponible',
    clientAccumulatedDebtAtRecord: 15500,
    clientCreditLimitAtRecord: 75000,
    numberLower: 'ab-005',
    createdAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '770e8400-e29b-41d4-a716-446655660006',
    number: 'AB-006',
    orgId: ORG_ID,
    PK: `org#${ORG_ID}`,
    SK: 'payment#770e8400-e29b-41d4-a716-446655660006',
    clientId: CLIENT_IDS.enterprise,
    clientIdGSI: CLIENT_IDS.enterprise,
    clientName: CLIENT_NAMES.enterprise,
    creditNoteId: CREDIT_NOTE_IDS.nc006,
    creditNoteIdGSI: CREDIT_NOTE_IDS.nc006,
    invoiceNumber: 'FAC-2024-061',
    amount: 5000,
    method: 'bank_transfer' as const,
    methodGSI: 'bank_transfer' as const,
    status: 'confirmed' as const,
    statusGSI: 'confirmed' as const,
    bankName: 'Banco Provincial',
    reference: 'REF-WIRE-2024-061',
    description: 'Transferencia internacional',
    clientAccumulatedDebtAtRecord: 10000,
    clientCreditLimitAtRecord: 250000,
    numberLower: 'ab-006',
    createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

async function seed() {
  try {
    console.log(`Seeding payments into table: ${TABLE}`);
    console.log(`Organization: ${ORG_ID}\n`);

    for (const payment of seedPayments) {
      await ddb.send(new PutCommand({ TableName: TABLE, Item: payment }));
      console.log(`✓ Created: ${payment.number} - ${payment.clientName} (Status: ${payment.status}, Amount: $${payment.amount})`);
    }

    console.log(`\n✓ Seed completed successfully! ${seedPayments.length} payments inserted.`);
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

seed();
