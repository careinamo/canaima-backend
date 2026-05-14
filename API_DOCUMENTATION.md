# Canaima Backend API Documentation

## Overview

Canaima Backend is a B2B credit and accounts-receivable serverless application built with:
- **Framework**: Serverless Framework v4
- **Runtime**: Node.js 24.x
- **Language**: TypeScript
- **Storage**: AWS DynamoDB (single-table design)
- **Deployment**: AWS Lambda + HTTP API Gateway

## Project Structure

```
src/
├── functions/
│   ├── hello/              # Example function
│   └── clients/            # Clients module
│       ├── handler.ts      # Route handlers (5 endpoints)
│       ├── repository.ts   # DynamoDB operations
│       ├── validators.ts   # Input validation
│       └── types.ts        # TypeScript interfaces
└── seeds/
    └── clients.ts          # Database seed data
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
TABLE_CLIENTS_BASE=clientsaaa
AWS_REGION=us-east-2
SEED_ORG_ID=org-default
```

**Variables:**
- `TABLE_CLIENTS_BASE`: Base name for the clients table (stage is appended: `clientsaaa-dev`, `clientsaaa-prod`)
- `AWS_REGION`: AWS region for DynamoDB connection
- `SEED_ORG_ID`: Organization ID used by the seed script

## Clients API Endpoints

### Overview

The Clients module provides REST API endpoints for managing B2B client accounts scoped by organization. All endpoints are namespaced under `/orgs/{orgId}/clients`.

### Endpoints Table

| Method | Path | Handler | Description | Status Codes |
|--------|------|---------|-------------|--------------|
| **GET** | `/orgs/{orgId}/clients` | `listClients` | List all clients for an organization | 200 |
| **GET** | `/orgs/{orgId}/clients/{id}` | `getClient` | Retrieve a single client by ID | 200, 404 |
| **POST** | `/orgs/{orgId}/clients` | `createClient` | Create a new client | 201, 400, 409 |
| **PUT** | `/orgs/{orgId}/clients/{id}` | `updateClient` | Update an existing client | 200, 400, 404, 409 |
| **DELETE** | `/orgs/{orgId}/clients/{id}` | `deleteClient` | Delete a client | 200, 404 |

---

## Endpoint Details

### 1. GET /orgs/{orgId}/clients — List Clients

Retrieve a paginated list of all clients for a given organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (starts at 1) |
| `limit` | number | 20 | Records per page (max: 500) |
| `search` | string | - | Search term (matches name or email, case-insensitive) |
| `status` | string | - | Filter by status: `active`, `inactive`, or `overdue` |
| `sortBy` | string | `createdAt` | Field to sort by |
| `sortOrder` | string | `asc` | Sort direction: `asc` or `desc` |

**Example Request:**

```bash
GET /orgs/org-default/clients?page=1&limit=20&search=acme&status=active&sortBy=name&sortOrder=asc
```

**Response (200 OK):**

```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "orgId": "org-default",
      "name": "Acme Corporation",
      "email": "contact@acme.com",
      "phone": "+1-555-0100",
      "address": "123 Business Ave, New York, NY 10001",
      "status": "active",
      "creditLimit": 50000,
      "balance": 12500,
      "lastPayment": "2025-05-08T00:00:00.000Z",
      "notes": "Premium client with early payment history",
      "createdAt": "2025-04-13T00:00:00.000Z",
      "updatedAt": "2025-05-13T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "totalCount": 1
  }
}
```

---

### 2. GET /orgs/{orgId}/clients/{id} — Get Single Client

Retrieve a specific client by ID within an organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Client UUID |

**Example Request:**

```bash
GET /orgs/org-default/clients/550e8400-e29b-41d4-a716-446655440001
```

**Response (200 OK):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "orgId": "org-default",
  "name": "Acme Corporation",
  "email": "contact@acme.com",
  "phone": "+1-555-0100",
  "address": "123 Business Ave, New York, NY 10001",
  "status": "active",
  "creditLimit": 50000,
  "balance": 12500,
  "lastPayment": "2025-05-08T00:00:00.000Z",
  "notes": "Premium client with early payment history",
  "createdAt": "2025-04-13T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

**Error Responses:**

- **404 Not Found**: Client with the given ID does not exist

---

### 3. POST /orgs/{orgId}/clients — Create Client

Create a new client account within an organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | ✓ | Client name |
| `email` | string | ✓ | Client email (must be unique) |
| `phone` | string | - | Phone number |
| `address` | string | - | Physical address |
| `status` | string | ✓ | Status: `active`, `inactive`, or `overdue` |
| `creditLimit` | number | ✓ | Credit limit amount (≥ 0) |
| `notes` | string | - | Internal notes |

**Example Request:**

```bash
curl -X POST http://localhost:3000/orgs/org-default/clients \
  -H "Content-Type: application/json" \
  -d '{
    "name": "New Client Corp",
    "email": "contact@newclient.com",
    "phone": "+1-555-0200",
    "address": "500 Main St, Boston, MA 02101",
    "status": "active",
    "creditLimit": 75000,
    "notes": "Referred by Acme Corporation"
  }'
```

**Response (201 Created):**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "orgId": "org-default",
  "name": "New Client Corp",
  "email": "contact@newclient.com",
  "phone": "+1-555-0200",
  "address": "500 Main St, Boston, MA 02101",
  "status": "active",
  "creditLimit": 75000,
  "balance": 0,
  "notes": "Referred by Acme Corporation",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:30:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed (missing required field, invalid email format, etc.)
- **409 Conflict**: A client with this email already exists

---

### 4. PUT /orgs/{orgId}/clients/{id} — Update Client

Update one or more fields of an existing client.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Client UUID |

**Request Body:** (all fields optional)

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Client name |
| `email` | string | Client email (must remain unique) |
| `phone` | string | Phone number |
| `address` | string | Physical address |
| `status` | string | Status: `active`, `inactive`, or `overdue` |
| `creditLimit` | number | Credit limit amount (≥ 0) |
| `notes` | string | Internal notes |

**Example Request:**

```bash
curl -X PUT http://localhost:3000/orgs/org-default/clients/f47ac10b-58cc-4372-a567-0e02b2c3d479 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "overdue",
    "creditLimit": 100000
  }'
```

**Response (200 OK):**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "orgId": "org-default",
  "name": "New Client Corp",
  "email": "contact@newclient.com",
  "phone": "+1-555-0200",
  "address": "500 Main St, Boston, MA 02101",
  "status": "overdue",
  "creditLimit": 100000,
  "balance": 0,
  "notes": "Referred by Acme Corporation",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:35:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed
- **404 Not Found**: Client with the given ID does not exist
- **409 Conflict**: Email already exists on another client

---

### 5. DELETE /orgs/{orgId}/clients/{id} — Delete Client

Delete a client account.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Client UUID |

**Example Request:**

```bash
curl -X DELETE http://localhost:3000/orgs/org-default/clients/f47ac10b-58cc-4372-a567-0e02b2c3d479
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Client deleted"
}
```

**Error Responses:**

- **404 Not Found**: Client with the given ID does not exist

---

## DynamoDB Table Schema

### Overview

The table uses a **single-table design** with composite keys (`PK` + `SK`) to support multiple entity types within the same table. This enables efficient queries scoped by organization and allows future entity types (invoices, payments, etc.) to be stored alongside clients.

- **Table Name**: `{TABLE_CLIENTS_BASE}-{stage}` (e.g., `clientsaaa-dev`)
- **Billing Mode**: PAY_PER_REQUEST (on-demand)
- **Partition Key**: `PK` (String) — Format: `org#<orgId>`
- **Sort Key**: `SK` (String) — Format: `client#<clientId>`

### Key Structure

| Entity | PK | SK | Example |
|--------|----|----|---------|
| Client | `org#<orgId>` | `client#<clientId>` | PK=`org#org-default`, SK=`client#550e8400...` |
| *(future)* Invoice | `org#<orgId>` | `invoice#<invoiceId>` | PK=`org#org-default`, SK=`invoice#inv-001` |
| *(future)* Payment | `org#<orgId>` | `payment#<paymentId>` | PK=`org#org-default`, SK=`payment#pay-001` |

### Attributes

| Attribute | Type | Description | Notes |
|-----------|------|-------------|-------|
| `PK` | String | Partition key: `org#<orgId>` | Primary Key (HASH) |
| `SK` | String | Sort key: `client#<clientId>` | Primary Key (RANGE) |
| `id` | String | Client UUID | Business identifier |
| `orgId` | String | Organization ID | Business identifier |
| `name` | String | Client's display name | - |
| `nameLower` | String | Lowercase name for case-insensitive search | Internal use |
| `email` | String | Client's email address | - |
| `emailLower` | String | Lowercase email for unique lookups | Internal use |
| `phone` | String | Client's phone number | Optional |
| `address` | String | Client's physical address | Optional |
| `status` | String | Client status: `active`, `inactive`, `overdue` | - |
| `creditLimit` | Number | Maximum credit available to the client | Default: 0 |
| `balance` | Number | Current outstanding balance | Derived from invoices/payments |
| `lastPayment` | String | ISO 8601 timestamp of last payment | Optional |
| `notes` | String | Internal notes/comments | Optional |
| `createdAt` | String | ISO 8601 timestamp of creation | Auto-generated |
| `updatedAt` | String | ISO 8601 timestamp of last update | Auto-updated |

### Global Secondary Index (GSI)

**Index Name:** `emailIndex`

| Attribute | Type | Purpose |
|-----------|------|---------|
| `emailLower` | String | Partition Key for email uniqueness checks |

This index enables fast lookups to verify email uniqueness during client creation and updates.

### Storage Format

**Example DynamoDB Record:**

```json
{
  "PK": "org#org-default",
  "SK": "client#550e8400-e29b-41d4-a716-446655440001",
  "id": "550e8400-e29b-41d4-a716-446655440001",
  "orgId": "org-default",
  "name": "Acme Corporation",
  "nameLower": "acme corporation",
  "email": "contact@acme.com",
  "emailLower": "contact@acme.com",
  "phone": "+1-555-0100",
  "address": "123 Business Ave, New York, NY 10001",
  "status": "active",
  "creditLimit": 50000,
  "balance": 12500,
  "lastPayment": "2025-05-08T00:00:00.000Z",
  "notes": "Premium client with early payment history",
  "createdAt": "2025-04-13T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

### Key Design Decisions

1. **Single-Table Design**: Uses composite keys (`PK`/`SK`) with prefixes (`org#`, `client#`) to enable co-location of related entities (clients, invoices, payments) under the same organization partition. This enables efficient `Query` operations scoped to a single org.

2. **Query over Scan**: The `listClients` operation uses `Query` with `PK = org#<orgId> AND begins_with(SK, 'client#')` instead of a full table `Scan`, which is significantly more efficient and cost-effective.

3. **Lowercase Fields** (`nameLower`, `emailLower`): Stored alongside original values to enable case-insensitive search and email uniqueness checks without exposing them in API responses.

4. **Email Uniqueness**: Enforced globally via the `emailIndex` GSI and application-level checks in the `findClientByEmail()` repository function.

5. **Balance Tracking**: The `balance` field is computed or synchronized from related invoices/payments. This should be kept up-to-date via triggers or periodic reconciliation.

6. **Timestamps**: All timestamps are stored as ISO 8601 strings for compatibility and readability.

7. **PAY_PER_REQUEST**: No capacity planning required; suitable for B2B applications with unpredictable traffic patterns.

---

## Development

### Local Development

Start the local API with Serverless Offline:

```bash
npm run dev
```

The API will be available at `http://localhost:3000` with Lambda invocation endpoint at `http://localhost:3002`.

### Seed Database

Populate DynamoDB with sample client data:

```bash
npm run seed:clients
```

This command uses the table name, region, and organization ID from `.env`. Set `SEED_ORG_ID` to target a specific organization.

### Build & Validate

Compile TypeScript without running:

```bash
npm run build
```

### Deploy to AWS

Deploy to the `dev` stage in `us-east-2`:

```bash
npm run deploy -- --stage dev --region us-east-2
```

Deploy to `prod`:

```bash
npm run deploy:prod -- --region us-east-2
```

---

## Error Handling

All endpoints return standardized JSON error responses:

**Validation Error (400 Bad Request):**

```json
{
  "error": "email format is invalid"
}
```

**Resource Not Found (404 Not Found):**

```json
{
  "error": "Client not found"
}
```

**Conflict (409 Conflict):**

```json
{
  "error": "A client with this email already exists"
}
```

**Server Error (500 Internal Server Error):**

```json
{
  "error": "Internal server error"
}
```

---

## Data Validation

### Client Creation & Update Rules

- **name**: Required, non-empty string
- **email**: Required, valid email format, globally unique
- **phone**: Optional string
- **address**: Optional string
- **status**: Required, one of: `active`, `inactive`, `overdue`
- **creditLimit**: Required, non-negative number
- **notes**: Optional string

### Search & Filtering

- **Search** (`?search=term`): Case-insensitive match against `name` and `email`
- **Status Filter** (`?status=active`): Exact match on status field
- **Pagination**: Safe defaults (page=1, limit=20, max limit=500)
- **Sorting**: Available on any Client field (default: `createdAt` ascending)
