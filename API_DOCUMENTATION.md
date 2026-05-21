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
│   ├── credit-notes/       # Credit Notes module
│   │   ├── handler.ts      # Route handlers (5 endpoints)
│   │   ├── repository.ts   # DynamoDB operations
│   │   ├── validators.ts   # Input validation
│   │   └── types.ts        # TypeScript interfaces
│   └── payments/           # Payments module
│       ├── handler.ts      # Route handlers (5 endpoints)
│       ├── repository.ts   # DynamoDB operations
│       ├── validators.ts   # Input validation
│       └── types.ts        # TypeScript interfaces
└── seeds/
    ├── clients.ts          # Database seed data for clients
    ├── credit-notes.ts     # Database seed data for credit notes
    └── payments.ts         # Database seed data for payments
```

## Configuration

### Environment Variables

Create a `.env` file in the project root:

```env
TABLE_CLIENTS_BASE=clientsaaa
TABLE_CREDIT_NOTES_BASE=credit-notes
TABLE_PAYMENTS_BASE=payments
AWS_REGION=us-east-2
SEED_ORG_ID=org-default
```

**Variables:**
- `TABLE_CLIENTS_BASE`: Base name for the clients table (stage is appended: `clientsaaa-dev`, `clientsaaa-prod`)
- `TABLE_CREDIT_NOTES_BASE`: Base name for the credit notes table (stage is appended: `credit-notes-dev`, `credit-notes-prod`)
- `TABLE_PAYMENTS_BASE`: Base name for the payments table (stage is appended: `payments-dev`, `payments-prod`)
- `AWS_REGION`: AWS region for DynamoDB connection
- `SEED_ORG_ID`: Organization ID used by the seed script

---

## Credit Limit Logic Overview

The Canaima system enforces a **credit limit** mechanism to prevent clients from accumulating excessive debt. Here's how it works:

### Core Concepts

1. **`accumulatedDebt`**: Represents the client's total outstanding debt at any given time.
   - **Increases** when a credit note is created (client is owed money)
   - **Decreases** when a payment is received (client pays)
   - **Must always be** ≤ `creditLimit`

2. **`creditLimit`**: The maximum amount of debt a client is allowed to accumulate.
   - Set at client creation and can be updated at any time
   - When updated, system validates that current `accumulatedDebt` ≤ new `creditLimit`

3. **Atomic Transactions**: All debt modifications use DynamoDB TransactWriteCommand to ensure consistency:
   - **Credit Note Creation**: Adds `amount` to `accumulatedDebt` (validates beforehand that new total ≤ limit)
   - **Payment Creation**: Subtracts `amount` from `accumulatedDebt` (validates beforehand that amount ≤ current debt)

### Credit Limit Violation Scenarios

#### Scenario 1: Creating a Credit Note That Exceeds the Limit
When you try to create a credit note with an amount that would push `accumulatedDebt` over `creditLimit`:

**Request:**
```bash
curl -X POST "http://localhost:3000/orgs/org-default/credit-notes" \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "invoiceNumber": "INV-2024-001",
    "amount": 5000,
    "dueDate": "2025-06-12T00:00:00Z"
  }'
```

**Assume:** Client has `creditLimit: 50000` and `accumulatedDebt: 47000`  
**Result:** New debt would be 52000, which exceeds 50000

**Response (400 Bad Request):**
```json
{
  "error": "Credit limit exceeded",
  "type": "CREDIT_LIMIT_EXCEEDED",
  "data": {
    "creditLimit": 50000,
    "exceedAmount": 2000
  }
}
```

The `exceedAmount: 2000` tells the client exactly how much over the limit the transaction would be.

#### Scenario 2: Successful Credit Note Creation (Within Limit)
**Assume:** Client has `creditLimit: 50000` and `accumulatedDebt: 45000`  
**Request amount:** 5000 (total would be 50000 = exactly at limit)

**Response (201 Created):**
```json
{
  "id": "660e8400-e29b-41d4-a716-446655550001",
  "number": "NC-001",
  "orgId": "org-default",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "invoiceNumber": "INV-2024-001",
  "amount": 5000,
  "status": "pending",
  "dueDate": "2025-06-12T00:00:00Z",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:30:00.000Z"
}
```

#### Scenario 3: Updating Credit Limit to Below Current Debt
When updating a client's `creditLimit` to a value lower than current `accumulatedDebt`:

**Current state:** `creditLimit: 50000`, `accumulatedDebt: 45000`  
**Update request:** New `creditLimit: 40000`

**Response (400 Bad Request):**
```json
{
  "error": "Credit limit cannot be set below current accumulated debt"
}
```

---

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
| `creditLimit` | number | Credit limit amount (≥ 0). **If updated, must be ≥ current `accumulatedDebt`** |
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

**Credit Limit Validation Error:**

If attempting to update `creditLimit` to a value lower than current `accumulatedDebt`:

```bash
curl -X PUT http://localhost:3000/orgs/org-default/clients/550e8400-e29b-41d4-a716-446655440001 \
  -H "Content-Type: application/json" \
  -d '{
    "creditLimit": 10000
  }'
```

**Response (400 Bad Request):**

```json
{
  "error": "Credit limit cannot be set below current accumulated debt"
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

**Credit Limit Integration:** Creating a credit note increases the client's `accumulatedDebt`. The system prevents credit note creation if it would cause `accumulatedDebt` to exceed the client's `creditLimit`.

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
| `clientId` | string | - | Filter credit notes belonging to a specific client (uses DynamoDB `clientIdIndex` GSI) |
| `sortBy` | string | `createdAt` | Field to sort by |
| `sortOrder` | string | `asc` | Sort direction: `asc` or `desc` |

**Example Request (all credit notes):**

```bash
curl http://localhost:3000/orgs/org-default/credit-notes?page=1\&limit=20\&search=NC-001\&status=pending\&sortBy=amount\&sortOrder=desc
```

**Example Request (filter by clientId):**

```bash
curl "http://localhost:3000/orgs/org-default/credit-notes?clientId=550e8400-e29b-41d4-a716-446655440001&page=1&limit=20"
```

**Response (200 OK) — filtered by clientId:**

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
      "paid": 0,
      "status": "pending",
      "dueDate": "2025-06-12T00:00:00.000Z",
      "description": "Credit for returned goods",
      "createdAt": "2025-05-03T00:00:00.000Z",
      "updatedAt": "2025-05-13T00:00:00.000Z"
    },
    {
      "id": "660e8400-e29b-41d4-a716-446655550002",
      "number": "NC-002",
      "orgId": "org-default",
      "clientId": "550e8400-e29b-41d4-a716-446655440001",
      "clientName": "Acme Corporation",
      "invoiceNumber": "INV-2024-015",
      "amount": 2500,
      "paid": 2500,
      "status": "paid",
      "dueDate": "2025-05-15T00:00:00.000Z",
      "description": "Early payment discount",
      "createdAt": "2025-04-30T00:00:00.000Z",
      "updatedAt": "2025-05-20T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalPages": 1,
    "totalCount": 2
  }
}
```

> **Note:** When `clientId` is provided, the query uses the `clientIdIndex` DynamoDB GSI for efficient lookup instead of scanning the full organization partition. You can combine it with `status`, `search`, `sortBy`, and `sortOrder` for further filtering.

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
      "paid": 0,
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
  "paid": 0,
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

**Important:** This endpoint integrates with the **credit limit system**. The system will prevent creation if the new debt would exceed the client's credit limit.

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

**Example Request (Success):**

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
  "paid": 0,
  "status": "pending",
  "dueDate": "2025-06-12T00:00:00.000Z",
  "description": "Credit for returned goods",
  "createdAt": "2025-05-13T14:30:00.000Z",
  "updatedAt": "2025-05-13T14:30:00.000Z"
}
```

**Example Request (Credit Limit Exceeded):**

Assume client has `creditLimit: 50000` and `accumulatedDebt: 49500`. Attempting to create a credit note with `amount: 1000`:

```bash
curl -X POST http://localhost:3000/orgs/org-default/credit-notes \
  -H "Content-Type: application/json" \
  -d '{
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "clientName": "Acme Corporation",
    "invoiceNumber": "INV-2024-001",
    "amount": 1000,
    "status": "pending",
    "dueDate": "2025-06-12T00:00:00Z",
    "description": "Credit for returned goods"
  }'
```

**Response (400 Bad Request):**

```json
{
  "error": "Credit limit exceeded",
  "type": "CREDIT_LIMIT_EXCEEDED",
  "data": {
    "creditLimit": 50000,
    "exceedAmount": 500
  }
}
```

The response includes:
- `creditLimit`: The client's maximum allowed debt
- `exceedAmount`: How much the transaction would exceed the limit (new debt - credit limit)

**Error Responses:**

- **400 Bad Request**: Validation failed (missing required field, invalid date format, non-positive amount, etc.)
- **400 Bad Request**: Credit limit would be exceeded (structured error with `type`, `data`)
- **404 Not Found**: Client not found

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
  "paid": 0,
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

## Payments API Endpoints

### Overview

The Payments module manages payment records for clients. Each payment represents an amount received against an invoice, scoped by organization.

**Credit Limit Integration:** Creating a payment decreases the client's `accumulatedDebt`. The system prevents payment creation if the payment amount exceeds the client's current `accumulatedDebt`.

Base path: `/orgs/{orgId}/payments`

### Endpoints Table

| Method | Path | Handler | Description | Status Codes |
|--------|------|---------|-------------|-------------|
| **GET** | `/orgs/{orgId}/payments` | `listPayments` | List all payments (paginated with filters) | 200 |
| **GET** | `/orgs/{orgId}/payments/{id}` | `getPayment` | Get a specific payment | 200, 404 |
| **POST** | `/orgs/{orgId}/payments` | `createPayment` | Create a new payment | 201, 400 |
| **PUT** | `/orgs/{orgId}/payments/{id}` | `updatePayment` | Update a payment | 200, 400, 404 |
| **DELETE** | `/orgs/{orgId}/payments/{id}` | `deletePayment` | Delete a payment | 200, 404 |

---

## Payments Endpoint Details

### 1. GET /orgs/{orgId}/payments — List Payments

List all payments for an organization with pagination and filtering.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Query Parameters:**

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| page | number | 1 | Page number (starts at 1) |
| limit | number | 10 | Records per page (max: 100) |
| search | string | - | Search in: number, clientName, invoiceNumber (case-insensitive) |
| status | string | - | Filter by: confirmed, pending, rejected |
| method | string | - | Filter by: cash, bank_transfer, mobile_payment, credit_card, other |
| clientId | string | - | Filter payments for a specific client |
| creditNoteId | string | - | Filter payments for a specific credit note |
| sortBy | string | createdAt | Sort field: createdAt, amount, number, clientName |
| sortOrder | string | desc | Sort order: asc or desc |

**Example Request:**

```bash
curl "http://localhost:3000/orgs/org-default/payments?page=1&limit=10&status=confirmed&sortBy=amount&sortOrder=desc"
```

**Response (200 OK):**

```json
{
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655660001",
      "orgId": "org-default",
      "number": "AB-001",
      "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
      "clientId": "550e8400-e29b-41d4-a716-446655440001",
      "clientName": "Acme Corporation",
      "invoiceNumber": "FAC-2024-001",
      "amount": 5000,
      "method": "bank_transfer",
      "status": "confirmed",
      "bankName": "Banco Provincial",
      "reference": "REF-89012",
      "description": "Payment for invoice April",
      "createdAt": "2026-05-03T12:30:00.000Z",
      "updatedAt": "2026-05-03T12:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "totalPages": 5,
    "totalCount": 42
  }
}
```

---

### 2. GET /orgs/{orgId}/payments/{id} — Get Single Payment

Get a specific payment by ID.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| orgId | string | Organization ID |
| id | string | Payment UUID |

**Example Request:**

```bash
curl "http://localhost:3000/orgs/org-default/payments/770e8400-e29b-41d4-a716-446655660001"
```

**Response (200 OK):**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655660001",
  "orgId": "org-default",
  "number": "AB-001",
  "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "FAC-2024-001",
  "amount": 5000,
  "method": "bank_transfer",
  "status": "confirmed",
  "bankName": "Banco Provincial",
  "reference": "REF-89012",
  "description": "Payment for invoice April",
  "createdAt": "2026-05-03T12:30:00.000Z",
  "updatedAt": "2026-05-03T12:30:00.000Z"
}
```

**Error Responses:**

- **404 Not Found**: Payment does not exist or does not belong to the organization

---

### 3. POST /orgs/{orgId}/payments — Create Payment

Create a new payment.

**Important:** This endpoint integrates with the **credit limit system**. The system prevents payment creation if the payment amount exceeds the client's current `accumulatedDebt`. Additionally, each payment must be associated with an existing credit note. The payment amount is added to the credit note's `paid` field, and when `paid` reaches `amount`, the credit note status is automatically set to `paid`.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| orgId | string | Organization ID |

**Request Body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| creditNoteId | string | ✓ | Credit Note UUID (must reference an existing credit note) |
| clientId | string | ✓ | Client UUID |
| invoiceNumber | string | ✓ | Associated invoice number |
| amount | number | ✓ | Payment amount (must be > 0, cannot exceed credit note remaining balance) |
| method | string | ✓ | Payment method (cash, bank_transfer, mobile_payment, credit_card, other) |
| status | string | - | Payment status (confirmed, pending, rejected; default: pending) |
| bankName | string | - | Bank name (recommended for bank_transfer, mobile_payment) |
| reference | string | - | Transaction/voucher reference |
| description | string | - | Notes or observations |

**Example Request (Success):**

```bash
curl -X POST "http://localhost:3000/orgs/org-default/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "invoiceNumber": "FAC-2024-001",
    "amount": 5000,
    "method": "bank_transfer",
    "status": "pending",
    "bankName": "Banco Provincial",
    "reference": "REF-89012",
    "description": "Payment for invoice April"
  }'
```

**Response (201 Created):**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655660001",
  "orgId": "org-default",
  "number": "AB-001",
  "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "FAC-2024-001",
  "amount": 5000,
  "method": "bank_transfer",
  "status": "pending",
  "bankName": "Banco Provincial",
  "reference": "REF-89012",
  "description": "Payment for invoice April",
  "createdAt": "2026-05-13T14:30:00.000Z",
  "updatedAt": "2026-05-13T14:30:00.000Z"
}
```

**Example Request (Payment Exceeds Credit Note Remaining Balance):**

Assume credit note has `amount: 5000` and `paid: 4000` (remaining: 1000). Attempting to create a payment with `amount: 2000`:

```bash
curl -X POST "http://localhost:3000/orgs/org-default/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "invoiceNumber": "FAC-2024-001",
    "amount": 2000,
    "method": "bank_transfer"
  }'
```

**Response (400 Bad Request):**

```json
{
  "error": "Payment amount 2000 exceeds credit note remaining balance 1000"
}
```

**Example Request (Payment Exceeds Accumulated Debt):**

Assume client has `accumulatedDebt: 3000`. Attempting to create a payment with `amount: 5000`:

```bash
curl -X POST "http://localhost:3000/orgs/org-default/payments" \
  -H "Content-Type: application/json" \
  -d '{
    "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
    "clientId": "550e8400-e29b-41d4-a716-446655440001",
    "invoiceNumber": "FAC-2024-001",
    "amount": 5000,
    "method": "bank_transfer"
  }'
```

**Response (400 Bad Request):**

```json
{
  "error": "Payment amount 5000 cannot exceed client accumulated debt 3000"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed (missing required fields, invalid amount, invalid method, etc.)
- **400 Bad Request**: Payment amount exceeds accumulated debt
- **400 Bad Request**: Payment amount exceeds credit note remaining balance
- **404 Not Found**: Client not found in the organization
- **404 Not Found**: Credit note not found

---

### 4. PUT /orgs/{orgId}/payments/{id} — Update Payment

Update an existing payment (partial update).

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| orgId | string | Organization ID |
| id | string | Payment UUID |

**Request Body:** (all fields optional)

| Field | Type | Description |
|-------|------|-------------|
| creditNoteId | string | Credit Note UUID |
| clientId | string | Client UUID (re-resolves clientName) |
| invoiceNumber | string | Invoice number |
| amount | number | Payment amount (> 0) |
| method | string | Payment method |
| status | string | Payment status |
| bankName | string | Bank name |
| reference | string | Transaction reference |
| description | string | Notes |

**Example Request:**

```bash
curl -X PUT "http://localhost:3000/orgs/org-default/payments/770e8400-e29b-41d4-a716-446655660001" \
  -H "Content-Type: application/json" \
  -d '{
    "status": "confirmed",
    "description": "Payment confirmed"
  }'
```

**Response (200 OK):**

```json
{
  "id": "770e8400-e29b-41d4-a716-446655660001",
  "orgId": "org-default",
  "number": "AB-001",
  "creditNoteId": "660e8400-e29b-41d4-a716-446655550001",
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "FAC-2024-001",
  "amount": 5000,
  "method": "bank_transfer",
  "status": "confirmed",
  "bankName": "Banco Provincial",
  "reference": "REF-89012",
  "description": "Payment confirmed",
  "createdAt": "2026-05-13T14:30:00.000Z",
  "updatedAt": "2026-05-13T14:35:00.000Z"
}
```

**Error Responses:**

- **400 Bad Request**: Validation failed
- **404 Not Found**: Payment does not exist or client not found

---

### 5. DELETE /orgs/{orgId}/payments/{id} — Delete Payment

Delete a payment.

**Path Parameters:**

| Param | Type | Description |
|-------|------|-------------|
| orgId | string | Organization ID |
| id | string | Payment UUID |

**Example Request:**

```bash
curl -X DELETE "http://localhost:3000/orgs/org-default/payments/770e8400-e29b-41d4-a716-446655660001"
```

**Response (200 OK):**

```json
{
  "success": true,
  "message": "Payment deleted"
}
```

**Error Responses:**

- **404 Not Found**: Payment does not exist

---

## DynamoDB Table Schemas

### Clients Table

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
| `paid` | Number | Total amount paid against this credit note | Starts at 0, incremented by payments |
| `status` | String | Status: `pending`, `partial`, or `paid` | Auto-updated when `paid` reaches `amount` |
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
  "paid": 0,
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

### Payments Table

- **Table Name**: `{TABLE_PAYMENTS_BASE}-{stage}` (e.g., `payments-dev`)
- **Billing Mode**: PAY_PER_REQUEST
- **Partition Key**: `PK` (String) — Format: `org#<orgId>`
- **Sort Key**: `SK` (String) — Format: `payment#<paymentId>`

#### Attributes

| Attribute | Type | Description | Notes |
|-----------|------|-------------|-------|
| `PK` | String | Partition key: `org#<orgId>` | Primary Key (HASH) |
| `SK` | String | Sort key: `payment#<paymentId>` | Primary Key (RANGE) |
| `id` | String | Payment UUID | Business identifier |
| `orgId` | String | Organization ID | Business identifier |
| `number` | String | Payment number (AB-001, AB-002, etc.) | Auto-generated if not provided |
| `numberLower` | String | Lowercase number for case-insensitive search | Internal use |
| `creditNoteId` | String | Associated Credit Note UUID | Reference to Credit Notes table |
| `creditNoteIdGSI` | String | Credit Note UUID copy | creditNoteIdIndex |
| `clientId` | String | Client UUID | Reference to Clients table |
| `clientIdGSI` | String | Client UUID copy | clientIdIndex |
| `clientName` | String | Client name (denormalized) | For list display |
| `invoiceNumber` | String | Invoice number | - |
| `amount` | Number | Payment amount | Must be > 0 |
| `method` | String | Payment method | cash, bank_transfer, mobile_payment, credit_card, other |
| `methodGSI` | String | Payment method copy | methodIndex |
| `status` | String | Payment status | confirmed, pending, rejected |
| `statusGSI` | String | Status copy | statusIndex |
| `bankName` | String | Bank name (optional) | - |
| `reference` | String | Reference/voucher (optional) | - |
| `description` | String | Notes (optional) | - |
| `createdAt` | String | ISO 8601 timestamp | Auto-generated |
| `updatedAt` | String | ISO 8601 timestamp | Auto-updated |

#### Global Secondary Indexes (GSI)

| Index Name | Partition Key | Purpose |
|------------|----------------|---------|
| clientIdIndex | clientIdGSI | Filter payments by client |
| creditNoteIdIndex | creditNoteIdGSI | Filter payments by credit note |
| statusIndex | statusGSI | Filter payments by status |
| methodIndex | methodGSI | Filter payments by method |

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

**Seed payments only:**
```bash
npm run seed:payments
```

**Seed all (clients, credit notes, and payments):**
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

**Credit Limit Exceeded (400 Bad Request):**

```json
{
  "error": "Credit limit exceeded",
  "type": "CREDIT_LIMIT_EXCEEDED",
  "data": {
    "creditLimit": 50000,
    "exceedAmount": 2000
  }
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

### Client Validation Rules

- **name**: Required, non-empty string
- **email**: Required, valid email format, globally unique
- **phone**: Optional string
- **address**: Optional string
- **status**: Required, one of: `active`, `inactive`, `overdue`
- **creditLimit**: Required, non-negative number (cannot be set below current `accumulatedDebt`)
- **notes**: Optional string

### Credit Note Validation Rules

- **clientId**: Required, must be a valid UUID referencing an existing Client
- **invoiceNumber**: Required, non-empty string
- **amount**: Required, positive number (> 0)
- **status**: Optional, one of: `pending`, `partial`, `paid` (default: `pending`)
- **dueDate**: Required, valid ISO 8601 date string
- **description**: Optional string
- **Credit Limit Enforcement**: Creating a credit note will fail with HTTP 400 if `accumulatedDebt + amount > creditLimit`

### Payment Validation Rules

- **creditNoteId**: Required, must reference an existing Credit Note
- **clientId**: Required, must be a valid UUID referencing an existing Client
- **invoiceNumber**: Required, non-empty string
- **amount**: Required, positive number (> 0)
- **method**: Required, one of: `cash`, `bank_transfer`, `mobile_payment`, `credit_card`, `other`
- **status**: Optional, one of: `confirmed`, `pending`, `rejected` (default: `pending`)
- **bankName**: Optional string (recommended for bank_transfer, mobile_payment)
- **reference**: Optional string
- **description**: Optional string
- **Accumulated Debt Enforcement**: Creating a payment will fail with HTTP 400 if `amount > accumulatedDebt`
- **Credit Note Balance Enforcement**: Creating a payment will fail with HTTP 400 if `amount > (creditNote.amount - creditNote.paid)`

### Search & Filtering

- **Search** (`?search=term`): Case-insensitive match against applicable fields
- **Status Filters**: Exact match on status field
- **Pagination**: Safe defaults (page=1, limit varies, max limit enforced)
- **Sorting**: Available on any resource field (default: `createdAt` ascending/descending per endpoint)
- **Sequential Numbers**: Credit note and payment numbers are auto-generated in sequence using atomic counters in DynamoDB

---

## Atomic Transactions

The system uses **DynamoDB TransactWriteCommand** for all debt modifications to ensure data consistency:

### Credit Note Creation Transaction
```
1. PUT: Create new credit note record
2. UPDATE: Increment client accumulatedDebt
   - Condition: attribute_exists(PK)
   - Expression: SET accumulatedDebt = accumulatedDebt + :amount
```

### Payment Creation Transaction
```
1. PUT: Create new payment record
2. UPDATE: Decrement client accumulatedDebt
   - Condition: attribute_exists(PK)
   - Expression: SET accumulatedDebt = accumulatedDebt - :amount
   - Also SET: lastPayment = :now
3. UPDATE: Increment credit note paid amount and update status
   - Condition: attribute_exists(PK)
   - Expression: SET paid = :newPaid, status = :newStatus
   - Status logic: if paid >= amount → 'paid', else → 'partial'
```

All three transactions are atomic: all operations succeed or all are rolled back, ensuring the client's `accumulatedDebt` and the credit note's `paid` field stay in sync.

---

## Implementation Notes

### Backward Compatibility

The system maintains backward compatibility with legacy `balance` field by mapping it to `accumulatedDebt` in read operations. Any old records with `balance` will be treated as `accumulatedDebt`.

### Multi-Tenancy

All tables use organization-scoped partition keys (`org#<orgId>`) to ensure complete data isolation between organizations. Query operations are scoped to a single organization's partition for security and performance.

### Scalability

Using PAY_PER_REQUEST billing mode ensures the system scales automatically with demand without capacity planning. The single-table design with composite keys enables efficient queries and future feature additions.
