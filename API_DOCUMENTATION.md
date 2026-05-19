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
│   ├── clients/            # Clients module
│   │   ├── handler.ts      # Route handlers (5 endpoints)
│   │   ├── repository.ts   # DynamoDB operations
│   │   ├── validators.ts   # Input validation
│   │   └── types.ts        # TypeScript interfaces
│   └── credit-notes/       # Credit Notes module
│       ├── handler.ts      # Route handlers (5 endpoints)
│       ├── repository.ts   # DynamoDB operations
│       ├── validators.ts   # Input validation
│       └── types.ts        # TypeScript interfaces
└── seeds/
    ├── clients.ts          # Database seed data for clients
    └── credit-notes.ts     # Database seed data for credit notes
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
TABLE_CLIENTS_BASE=clientsaaa
TABLE_CREDIT_NOTES_BASE=credit-notes
AWS_REGION=us-east-2
SEED_ORG_ID=org-default
```

**Variables:**
- `TABLE_CLIENTS_BASE`: Base name for the clients table (stage is appended: `clientsaaa-dev`, `clientsaaa-prod`)
- `TABLE_CREDIT_NOTES_BASE`: Base name for the credit notes table (stage is appended: `credit-notes-dev`, `credit-notes-prod`)
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
curl http://localhost:3000/orgs/org-default/clients?page=1\&limit=20\&search=acme\&status=active\&sortBy=name\&sortOrder=asc
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
      "accumulatedDebt": 12500,
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
curl http://localhost:3000/orgs/org-default/clients/550e8400-e29b-41d4-a716-446655440001
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
  "accumulatedDebt": 12500,
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
| `status` | string | - | Status: `active`, `inactive`, or `overdue` (default: `active`) |
| `creditLimit` | number | - | Credit limit amount (≥ 0, default: `0`) |
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
  "accumulatedDebt": 0,
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
  "accumulatedDebt": 0,
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

## Credit Notes API Endpoints

### Overview

The Credit Notes module provides REST API endpoints for managing B2B credit notes (adjustments, allowances, and credits) for invoices. All endpoints are namespaced under `/orgs/{orgId}/credit-notes` and scoped by organization.

### Endpoints Table

| Method | Path | Handler | Description | Status Codes |
|--------|------|---------|-------------|-------------|
| **GET** | `/orgs/{orgId}/credit-notes` | `listCreditNotes` | List all credit notes for an organization | 200 |
| **GET** | `/orgs/{orgId}/credit-notes/{id}` | `getCreditNote` | Retrieve a single credit note by ID | 200, 404 |
| **POST** | `/orgs/{orgId}/credit-notes` | `createCreditNote` | Create a new credit note | 201, 400 |
| **PUT** | `/orgs/{orgId}/credit-notes/{id}` | `updateCreditNote` | Update an existing credit note | 200, 400, 404 |
| **DELETE** | `/orgs/{orgId}/credit-notes/{id}` | `deleteCreditNote` | Delete a credit note | 200, 404 |

---

## Credit Notes Endpoint Details

### 1. GET /orgs/{orgId}/credit-notes — List Credit Notes

Retrieve a paginated list of all credit notes for a given organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number (starts at 1) |
| `limit` | number | 20 | Records per page (max: 500) |
| `search` | string | - | Search term (matches number, client name, or invoice number, case-insensitive) |
| `status` | string | - | Filter by status: `pending`, `partial`, or `paid` |
| `sortBy` | string | `createdAt` | Field to sort by |
| `sortOrder` | string | `asc` | Sort direction: `asc` or `desc` |

**Example Request:**

```bash
curl http://localhost:3000/orgs/org-default/credit-notes?page=1\&limit=20\&search=NC-001\&status=pending\&sortBy=amount\&sortOrder=desc
```

**Response (200 OK):**

```json
{
  "data": [
    {
      "id": "660e8400-e29b-41d4-a716-446655550001",
      "number": "NC-001",
      "orgId": "org-default",
      "clientId": "550e8400-e29b-41d4-a716-446655440001",
      "clientName": "Acme Corporation",
      "invoiceNumber": "INV-2024-001",
      "amount": 5000,
      "status": "pending",
      "dueDate": "2025-06-12T00:00:00.000Z",
      "description": "Credit for returned goods",
      "createdAt": "2025-05-03T00:00:00.000Z",
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

### 2. GET /orgs/{orgId}/credit-notes/{id} — Get Single Credit Note

Retrieve a specific credit note by ID within an organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Credit Note UUID |

**Example Request:**

```bash
curl http://localhost:3000/orgs/org-default/credit-notes/660e8400-e29b-41d4-a716-446655550001
```

**Response (200 OK):**

```json
{
  "id": "660e8400-e29b-41d4-a716-446655550001",
  "number": "NC-001",
  "orgId": "org-default",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "INV-2024-001",
  "amount": 5000,
  "status": "pending",
  "dueDate": "2025-06-12T00:00:00.000Z",
  "description": "Credit for returned goods",
  "createdAt": "2025-05-03T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

**Error Responses:**

- **404 Not Found**: Credit note with the given ID does not exist

---

### 3. POST /orgs/{orgId}/credit-notes — Create Credit Note

Create a new credit note for a client within an organization.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `number` | string | - | Credit note number (auto-generated as NC-001, NC-002, etc. if not provided) |
| `clientId` | string | ✓ | Client UUID |
| `clientName` | string | ✓ | Client's display name (denormalized) |
| `invoiceNumber` | string | ✓ | Related invoice number |
| `amount` | number | ✓ | Credit amount (must be positive) |
| `status` | string | - | Status: `pending`, `partial`, or `paid` (default: `pending`) |
| `dueDate` | string | ✓ | Due date in ISO 8601 format |
| `description` | string | - | Reason or description of the credit |

**Example Request:**

```bash
curl -X POST http://localhost:3000/orgs/org-default/credit-notes \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "clientName": "Acme Corporation",
    "invoiceNumber": "INV-2024-001",
    "amount": 5000,
    "status": "pending",
    "dueDate": "2025-06-12T00:00:00Z",
    "description": "Credit for returned goods"
  }'
```

**Response (201 Created):**

```json
{
  "id": "660e8400-e29b-41d4-a716-446655550001",
  "number": "NC-001",
  "orgId": "org-default",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "INV-2024-001",
  "amount": 5000,
  "status": "pending",
  "dueDate": "2025-06-12T00:00:00.000Z",
  "description": "Credit for returned goods",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:30:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed (missing required field, invalid date format, non-positive amount, etc.)

---

### 4. PUT /orgs/{orgId}/credit-notes/{id} — Update Credit Note

Update one or more fields of an existing credit note.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Credit Note UUID |

**Request Body:** (all fields optional)

| Field | Type | Description |
|-------|------|-------------|
| `number` | string | Credit note number |
| `clientId` | string | Client UUID |
| `clientName` | string | Client's display name |
| `invoiceNumber` | string | Related invoice number |
| `amount` | number | Credit amount (must be positive) |
| `status` | string | Status: `pending`, `partial`, or `paid` |
| `dueDate` | string | Due date in ISO 8601 format |
| `description` | string | Reason or description |

**Example Request:**

```bash
curl -X PUT http://localhost:3000/orgs/org-default/credit-notes/660e8400-e29b-41d4-a716-446655550001 \
  -H "Content-Type: application/json" \
  -d '{
    "status": "partial",
    "amount": 2500
  }'
```

**Response (200 OK):**

```json
{
  "id": "660e8400-e29b-41d4-a716-446655550001",
  "number": "NC-001",
  "orgId": "org-default",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "INV-2024-001",
  "amount": 2500,
  "status": "partial",
  "dueDate": "2025-06-12T00:00:00.000Z",
  "description": "Credit for returned goods",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:35:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed
- **404 Not Found**: Credit note with the given ID does not exist

---

### 5. DELETE /orgs/{orgId}/credit-notes/{id} — Delete Credit Note

Delete a credit note.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |
| `id` | string | Credit Note UUID |

**Example Request:**

```bash
curl -X DELETE http://localhost:3000/orgs/org-default/credit-notes/660e8400-e29b-41d4-a716-446655550001
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Credit note deleted"
}
```

**Error Responses:**

- **404 Not Found**: Credit note with the given ID does not exist

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
| `accumulatedDebt` | Number | Client's accumulated outstanding debt | Increased by credit notes and decreased by payments |
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
  "accumulatedDebt": 12500,
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

5. **Debt Tracking**: The `accumulatedDebt` field is updated transactionally when credit notes are created (adds amount) and when payments are created (subtracts amount), with guards so debt never exceeds `creditLimit`.

6. **Timestamps**: All timestamps are stored as ISO 8601 strings for compatibility and readability.

7. **PAY_PER_REQUEST**: No capacity planning required; suitable for B2B applications with unpredictable traffic patterns.

---

## Credit Notes DynamoDB Table Schema

### Overview

The Credit Notes table follows the same single-table design pattern as the Clients table, enabling efficient multi-tenant operations.

- **Table Name**: `{TABLE_CREDIT_NOTES_BASE}-{stage}` (e.g., `credit-notes-dev`)
- **Billing Mode**: PAY_PER_REQUEST (on-demand)
- **Partition Key**: `PK` (String) — Format: `org#<orgId>`
- **Sort Key**: `SK` (String) — Format: `creditnote#<noteId>`

### Key Structure

| Entity | PK | SK | Example |
|--------|----|----|----------|
| Credit Note | `org#<orgId>` | `creditnote#<noteId>` | PK=`org#org-default`, SK=`creditnote#660e8400...` |
| Counter | `org#<orgId>` | `counter#creditnotes` | PK=`org#org-default`, SK=`counter#creditnotes` |

### Attributes

| Attribute | Type | Description | Notes |
|-----------|------|-------------|-------|
| `PK` | String | Partition key: `org#<orgId>` | Primary Key (HASH) |
| `SK` | String | Sort key: `creditnote#<noteId>` | Primary Key (RANGE) |
| `id` | String | Credit Note UUID | Business identifier |
| `orgId` | String | Organization ID | Business identifier |
| `number` | String | Credit note number (NC-001, NC-002, etc.) | Auto-generated if not provided |
| `numberLower` | String | Lowercase number for case-insensitive search | Internal use |
| `clientId` | String | Associated client UUID | Reference to Clients table |
| `clientIdGSI` | String | Copy of clientId for GSI queries | For status filtering |
| `clientName` | String | Client's display name (denormalized) | For list display |
| `invoiceNumber` | String | Related invoice number | Reference to invoice |
| `amount` | Number | Credit amount | Must be positive |
| `status` | String | Status: `pending`, `partial`, or `paid` | - |
| `statusGSI` | String | Copy of status for GSI queries | For status-based filtering |
| `dueDate` | String | ISO 8601 timestamp | Payment/application due date |
| `description` | String | Reason or notes for the credit | Optional |
| `createdAt` | String | ISO 8601 timestamp of creation | Auto-generated |
| `updatedAt` | String | ISO 8601 timestamp of last update | Auto-updated |

### Global Secondary Indexes (GSI)

**Index Name:** `statusIndex`

| Attribute | Type | Purpose |
|-----------|------|----------|
| `statusGSI` | String | Partition Key for filtering credit notes by status |

**Index Name:** `clientIdIndex`

| Attribute | Type | Purpose |
|-----------|------|----------|
| `clientIdGSI` | String | Partition Key for filtering credit notes by client |

### Storage Format

**Example DynamoDB Record:**

```json
{
  "PK": "org#org-default",
  "SK": "creditnote#660e8400-e29b-41d4-a716-446655550001",
  "id": "660e8400-e29b-41d4-a716-446655550001",
  "orgId": "org-default",
  "number": "NC-001",
  "numberLower": "nc-001",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientIdGSI": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "INV-2024-001",
  "amount": 5000,
  "status": "pending",
  "statusGSI": "pending",
  "dueDate": "2025-06-12T00:00:00.000Z",
  "description": "Credit for returned goods",
  "createdAt": "2025-05-03T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

### Counter Record

For sequential note number generation:

```json
{
  "PK": "org#org-default",
  "SK": "counter#creditnotes",
  "counter": 6
}
```

---

## Development

### Local Development

Start the local API with Serverless Offline:

```bash
npm run dev
```

The API will be available at `http://localhost:3000` with Lambda invocation endpoint at `http://localhost:3002`.

### Seed Database

Populate DynamoDB with sample data:

**Seed clients only:**
```bash
npm run seed:clients
```

**Seed credit notes only:**
```bash
npm run seed:credit-notes
```

**Seed both (clients and credit notes):**
```bash
npm run seed
```

These commands use the table names, region, and organization ID from `.env`. Set `SEED_ORG_ID` to target a specific organization.

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

---

## Credit Notes Data Validation

### Credit Note Creation & Update Rules

- **number**: Optional string; auto-generated as NC-XXX if not provided
- **clientId**: Required, must be a valid UUID referencing an existing Client
- **clientName**: Required, non-empty string (denormalized from Client for display)
- **invoiceNumber**: Required, non-empty string
- **amount**: Required, positive number (> 0)
- **status**: Optional, one of: `pending`, `partial`, `paid` (default: `pending`)
- **dueDate**: Required, valid ISO 8601 date string
- **description**: Optional string

### Search & Filtering

- **Search** (`?search=term`): Case-insensitive match against `number`, `clientName`, and `invoiceNumber`
- **Status Filter** (`?status=pending`): Exact match on status field (pending, partial, paid)
- **Pagination**: Safe defaults (page=1, limit=20, max limit=500)
- **Sorting**: Available on any CreditNote field (default: `createdAt` ascending)
- **Sequential Numbers**: Credit note numbers are auto-generated in sequence (NC-001, NC-002, etc.) using an atomic counter in DynamoDB
