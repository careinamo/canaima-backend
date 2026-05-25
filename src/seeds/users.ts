import 'dotenv/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const TABLE = 'users-dev';
const REGION = process.env.AWS_REGION || 'us-east-2';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: REGION }), {
  marshallOptions: { removeUndefinedValues: true },
});

const seedUsers = [
  {
    PK: 'USER#user_default',
    SK: 'PROFILE',
    clerkUserId: 'user_default',
    email: 'demo@example.com',
    firstName: 'Demo',
    lastName: 'User',
    imageUrl: 'https://avatar.example.com/demo.jpg',
    createdAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'USER#user_demo',
    SK: 'PROFILE',
    clerkUserId: 'user_demo',
    email: 'john.doe@acme.com',
    firstName: 'John',
    lastName: 'Doe',
    imageUrl: 'https://avatar.example.com/john.jpg',
    createdAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'USER#user_demo2',
    SK: 'PROFILE',
    clerkUserId: 'user_demo2',
    email: 'jane.smith@techstart.io',
    firstName: 'Jane',
    lastName: 'Smith',
    imageUrl: 'https://avatar.example.com/jane.jpg',
    createdAt: new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'USER#user_admin',
    SK: 'PROFILE',
    clerkUserId: 'user_admin',
    email: 'admin@canaima.io',
    firstName: 'Admin',
    lastName: 'User',
    imageUrl: 'https://avatar.example.com/admin.jpg',
    createdAt: new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    PK: 'USER#user_startup_ceo',
    SK: 'PROFILE',
    clerkUserId: 'user_startup_ceo',
    email: 'alex.rodriguez@startupventures.com',
    firstName: 'Alex',
    lastName: 'Rodriguez',
    imageUrl: 'https://avatar.example.com/alex.jpg',
    createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

async function seed() {
  try {
    console.log(`Seeding ${seedUsers.length} users to table: ${TABLE}`);

    for (const user of seedUsers) {
      await ddb.send(
        new PutCommand({
          TableName: TABLE,
          Item: user,
        }),
      );
      console.log(`✓ Created user: ${user.firstName} ${user.lastName}`);
    }

    console.log('✓ Users seed completed successfully');
  } catch (error) {
    console.error('✗ Error seeding users:', error);
    process.exit(1);
  }
}

seed();
