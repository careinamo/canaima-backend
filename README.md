# Canaima Backend

A serverless B2B credit and accounts-receivable management application built with modern cloud-native technologies.

## Overview

**Canaima Backend** is a RESTful API for managing clients, credit notes, and payment tracking. It leverages AWS Lambda, DynamoDB, and the Serverless Framework to provide a scalable, cost-effective solution for financial operations.

### Key Technologies

- **Framework:** Serverless Framework v4
- **Runtime:** Node.js 24.x
- **Language:** TypeScript
- **Database:** AWS DynamoDB (single-table design pattern)
- **Compute:** AWS Lambda
- **API Gateway:** AWS HTTP API Gateway

## Core Modules

### Clients Module
Manage client information and accounts
- 5 RESTful endpoints for CRUD operations
- DynamoDB repository layer for data persistence
- Input validation and TypeScript type definitions

### Credit Notes Module
Handle credit note operations
- 5 endpoints for credit note management
- Repository pattern for database interactions
- Request validation and data modeling

### Payments Module
Track and process payments
- 5 endpoints for payment management
- DynamoDB operations and data access layer
- Validation and type safety

## Quick Start

### Prerequisites

- Node.js 24.x or higher
- npm or yarn
- AWS Account (for deployment)
- AWS CLI configured with credentials

### Installation

1. **Clone and navigate to the project:**
   ```bash
   cd canaima-backend
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Setup environment variables:**
   ```bash
   cp .env.example .env
   ```
   
   Configure your `.env` file:
   ```env
   TABLE_CLIENTS_BASE=clients
   TABLE_CREDIT_NOTES_BASE=credit-notes
   TABLE_PAYMENTS_BASE=payments
   AWS_REGION=us-east-1
   SEED_ORG_ID=org-default
   ```

### Development

**Start the local development server:**
```bash
npm run dev
```

The API will be available at `http://localhost:3000`

**Run offline server:**
```bash
npm run offline
```

**Type checking:**
```bash
npm run build
```

**Linting:**
```bash
npm run lint
```

### Database Seeding

Populate the database with initial data:

```bash
# Seed all tables
npm run seed

# Or seed individual tables
npm run seed:clients
npm run seed:credit-notes
npm run seed:payments
```

## Deployment

### Deploy to Development

```bash
npm run deploy
```

### Deploy to Production

```bash
npm run deploy:prod
```

### Deploy to Specific Region

```bash
npm run deploy:dev:oregon
```

## Project Structure

```
src/
├── functions/
│   ├── hello/              # Example function
│   ├── clients/            # Clients module
│   │   ├── handler.ts      # Route handlers
│   │   ├── repository.ts   # DynamoDB operations
│   │   ├── validators.ts   # Input validation
│   │   └── types.ts        # TypeScript interfaces
│   ├── credit-notes/       # Credit Notes module
│   │   ├── handler.ts      # Route handlers
│   │   ├── repository.ts   # DynamoDB operations
│   │   ├── validators.ts   # Input validation
│   │   └── types.ts        # TypeScript interfaces
│   └── payments/           # Payments module
│       ├── handler.ts      # Route handlers
│       ├── repository.ts   # DynamoDB operations
│       ├── validators.ts   # Input validation
│       └── types.ts        # TypeScript interfaces
└── seeds/
    ├── clients.ts          # Database seed data for clients
    ├── credit-notes.ts     # Database seed data for credit notes
    └── payments.ts         # Database seed data for payments
```

## API Documentation

For detailed API endpoints and request/response examples, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start local development server |
| `npm run deploy` | Deploy to development stage |
| `npm run deploy:prod` | Deploy to production stage |
| `npm run deploy:dev:oregon` | Deploy to us-west-2 region |
| `npm run offline` | Run serverless offline |
| `npm run build` | TypeScript type checking |
| `npm run lint` | Run ESLint |
| `npm run seed` | Seed all database tables |
| `npm run seed:clients` | Seed clients table |
| `npm run seed:credit-notes` | Seed credit notes table |
| `npm run seed:payments` | Seed payments table |

## Architecture

The application follows clean architecture patterns with:

- **Handlers:** Define HTTP routes and handle incoming requests
- **Repositories:** Encapsulate database operations using DynamoDB SDK
- **Validators:** Validate input data and enforce business rules
- **Types:** TypeScript interfaces for type safety and documentation

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TABLE_CLIENTS_BASE` | `clients` | Base name for clients DynamoDB table |
| `TABLE_CREDIT_NOTES_BASE` | `credit-notes` | Base name for credit notes DynamoDB table |
| `TABLE_PAYMENTS_BASE` | `payments` | Base name for payments DynamoDB table |
| `AWS_REGION` | `us-east-1` | AWS region for deployment |
| `SEED_ORG_ID` | `org-default` | Default organization ID for seeding |

## Features

✅ Full TypeScript support for type safety  
✅ Environment-based configuration  
✅ Database seeding capabilities  
✅ CORS-enabled API Gateway  
✅ Stage-based deployments (dev/prod)  
✅ Offline development support  
✅ IAM role-based access control  
✅ DynamoDB single-table design  

## License

[Add your license here]

## Contact

[Add contact information if needed]
