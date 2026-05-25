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
│   ├── payments/           # Payments module
│   │   ├── handler.ts      # Route handlers (5 endpoints)
│   │   ├── repository.ts   # DynamoDB operations
│   │   ├── validators.ts   # Input validation
│   │   └── types.ts        # TypeScript interfaces
│   ├── credit-usage/       # Credit Usage metrics module
│   │   ├── handler.ts      # Scheduled and event-driven handlers
│   │   ├── repository.ts   # Metrics calculations and storage
│   │   ├── types.ts        # TypeScript interfaces for metrics
│   │   └── validators.ts   # Input validation
│   └── shared/
│       └── credit-usage-trigger.ts  # Utility to trigger credit usage calculation
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
TABLE_METRICS=metrics
AWS_REGION=us-east-2
SEED_ORG_ID=org-default
ORG_IDS=org-default
```

**Variables:**
- `TABLE_CLIENTS_BASE`: Base name for the clients table (stage is appended: `clientsaaa-dev`, `clientsaaa-prod`)
- `TABLE_CREDIT_NOTES_BASE`: Base name for the credit notes table (stage is appended: `credit-notes-dev`, `credit-notes-prod`)
- `TABLE_PAYMENTS_BASE`: Base name for the payments table (stage is appended: `payments-dev`, `payments-prod`)
- `TABLE_METRICS`: Base name for the metrics table (stage is appended: `metrics-dev`, `metrics-prod`)
- `AWS_REGION`: AWS region for DynamoDB connection
- `SEED_ORG_ID`: Organization ID used by the seed script
- `ORG_IDS`: Comma-separated list of organization IDs to process in the scheduled credit usage calculation

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
| **POST** | `/orgs/{orgId}/clients/bulk-import` | `bulkImportClients` | Import multiple clients from CSV (max 50) | 202, 400 |

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
| `active` | boolean | - | Filter by active status: `true` or `false` |
| `delinquent` | boolean | - | Filter by delinquent status: `true` or `false` |
| `sortBy` | string | `createdAt` | Field to sort by |
| `sortOrder` | string | `asc` | Sort direction: `asc` or `desc` |

**Example Request:**

```bash
curl http://localhost:3000/orgs/org-default/clients?page=1\&limit=20\&search=acme\&active=true\&delinquent=false\&sortBy=name\&sortOrder=asc
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
      "active": true,
      "delinquent": false,
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
| `active` | boolean | - | Whether the client is active (default: `true`) |
| `delinquent` | boolean | - | Whether the client is delinquent (default: `false`) |
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
    "active": true,
    "delinquent": false,
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
  "active": true,
  "delinquent": false,
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
| `active` | boolean | Whether the client is active |
| `delinquent` | boolean | Whether the client is delinquent |
| `creditLimit` | number | Credit limit amount (≥ 0). **If updated, must be ≥ current `accumulatedDebt`** |
| `accumulatedDebt` | number | Accumulated debt amount (≥ 0). **If updated, must be ≤ client's `creditLimit`** |
| `notes` | string | Internal notes |

**Example Request:**

```bash
curl -X PUT http://localhost:3000/orgs/org-default/clients/f47ac10b-58cc-4372-a567-0e02b2c3d479 \
  -H "Content-Type: application/json" \
  -d '{
    "active": false,
    "delinquent": true,
    "creditLimit": 100000,
    "accumulatedDebt": 25000
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
  "active": false,
  "delinquent": true,
  "creditLimit": 100000,
  "accumulatedDebt": 25000,
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

### 6. POST /orgs/{orgId}/clients/bulk-import — Bulk Import Clients

Import multiple clients at once from a CSV file. Maximum of 50 clients per request.

**Path Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Organization ID |

**Request Body:**

Plain text CSV content with the following format:
- **Header row required** with column names: `name`, `email`, and optionally: `phone`, `address`, `active`, `delinquent`, `creditLimit`, `notes`
- One client per line
- Columns separated by commas
- Maximum 50 data rows (excluding header)

**CSV Format Example:**

```csv
name,email,phone,address,active,delinquent,creditLimit,notes
Acme Corp,contact@acme.com,+1-555-0100,123 Main St,true,false,50000,Key account
Tech Solutions,info@techsol.com,+1-555-0101,456 Oak Ave,true,false,75000,Referred by Acme
Global Traders,sales@global.com,+1-555-0102,789 Pine Rd,false,false,30000,On hold
```

**Example Request:**

```bash
curl -X POST http://localhost:3000/orgs/org-default/clients/bulk-import \
  -H "Content-Type: text/plain" \
  --data-binary @clients.csv
```

Or inline:

```bash
curl -X POST http://localhost:3000/orgs/org-default/clients/bulk-import \
  -H "Content-Type: text/plain" \
  -d "name,email,phone,address,active,delinquent,creditLimit,notes
Acme Corp,contact@acme.com,+1-555-0100,123 Main St,true,false,50000,Key account
Tech Solutions,info@techsol.com,+1-555-0101,456 Oak Ave,true,false,75000,Referred"
```

**Response (202 Accepted):**

```json
{
  "summary": {
    "totalRows": 2,
    "validRows": 2,
    "createdCount": 2,
    "failedCount": 0
  },
  "created": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "orgId": "org-default",
      "name": "Acme Corp",
      "email": "contact@acme.com",
      "phone": "+1-555-0100",
      "address": "123 Main St",
      "status": "active",
      "creditLimit": 50000,
      "accumulatedDebt": 0,
      "notes": "Key account",
      "createdAt": "2025-05-13T14:30:00.000Z",
      "updatedAt": "2025-05-13T14:30:00.000Z"
    },
    {
      "id": "550e8400-e29b-41d4-a716-446655440002",
      "orgId": "org-default",
      "name": "Tech Solutions",
      "email": "info@techsol.com",
      "phone": "+1-555-0101",
      "address": "456 Oak Ave",
      "active": true,
      "delinquent": false,
      "creditLimit": 75000,
      "accumulatedDebt": 0,
      "notes": "Referred",
      "createdAt": "2025-05-13T14:30:00.000Z",
      "updatedAt": "2025-05-13T14:30:00.000Z"
    }
  ],
  "errors": []
}
```

**Response (202 Accepted) — With Errors:**

When some rows fail validation but others succeed:

```json
{
  "summary": {
    "totalRows": 3,
    "validRows": 2,
    "createdCount": 1,
    "failedCount": 2
  },
  "created": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440001",
      "orgId": "org-default",
      "name": "Acme Corp",
      "email": "contact@acme.com",
      "phone": "+1-555-0100",
      "address": "123 Main St",
      "status": "active",
      "creditLimit": 50000,
      "accumulatedDebt": 0,
      "notes": "Key account",
      "createdAt": "2025-05-13T14:30:00.000Z",
      "updatedAt": "2025-05-13T14:30:00.000Z"
    }
  ],
  "errors": [
    {
      "rowNumber": 2,
      "error": "email format is invalid"
    },
    {
      "rowNumber": 3,
      "error": "Email already exists"
    }
  ]
}
```

**Error Responses:**

- **400 Bad Request**: CSV parsing error (missing header, malformed CSV, etc.)
- **400 Bad Request**: No valid rows to import (all rows failed validation)

**Validation Rules:**

- `name` and `email` are required columns
- `name` must not be empty
- `email` must be in valid email format (XXX@XXX.XXX)
- `email` must be unique across the organization (checked against existing clients and duplicates within the batch)
- `active` must be a boolean (defaults to `true` if omitted)
- `delinquent` must be a boolean (defaults to `false` if omitted)
- `creditLimit` must be a non-negative number (defaults to 0 if omitted)
- `phone`, `address`, and `notes` are optional

**Partial Success Handling:**

The endpoint uses an all-or-nothing approach per row:
- Valid rows are created immediately
- Invalid rows are reported in the `errors` array with detailed error messages
- The response always returns 202 (Accepted) if at least one row is valid
- The `summary` object shows exactly how many succeeded and how many failed

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

### Credit Note Status Values

A credit note can have one of the following statuses:

| Status | Description |
|--------|-------------|
| **pending** | Credit note has been created but has no payments recorded yet. `paid` = 0 |
| **partial** | Credit note has received one or more payments, but the total paid amount is less than the credit note amount. 0 < `paid` < `amount` |
| **paid** | Credit note has been completely paid. `paid` = `amount` |
| **overdue** | Credit note has passed its due date and remains unpaid or partially paid. Automatically set when `dueDate` < current date and status is not `paid` |

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
| `status` | string | - | Filter by status: `pending`, `partial`, `paid`, or `overdue` |
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
      "clientAccumulatedDebtAtRecord": 5000,
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
      "clientAccumulatedDebtAtRecord": 7500,
      "clientCreditLimitAtRecord": 50000,
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
      "clientAccumulatedDebtAtRecord": 5000,
      "clientCreditLimitAtRecord": 50000,
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
  "clientAccumulatedDebtAtRecord": 5000,
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
| `status` | string | - | Status: `pending`, `partial`, `paid`, or `overdue` (default: `pending`) |
| `dueDate` | string | ✓ | Due date in ISO 8601 format |
| `description` | string | - | Reason or description of the credit |

**Note:** The response includes `clientAccumulatedDebtAtRecord` (the client's accumulated debt after this credit note was created). This is an audit/history field automatically populated by the system and should not be included in requests.

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
  "clientAccumulatedDebtAtRecord": 5000,
  "clientCreditLimitAtRecord": 50000,
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
| `status` | string | Status: `pending`, `partial`, `paid`, or `overdue` |
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
  "clientAccumulatedDebtAtRecord": 5000,
  "clientCreditLimitAtRecord": 50000,
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

**Example Request (all payments):**

```bash
curl "http://localhost:3000/orgs/org-default/payments?page=1&limit=10&status=confirmed&sortBy=amount&sortOrder=desc"
```

**Example Request (filter by clientId):**

```bash
curl "http://localhost:3000/orgs/org-default/payments?clientId=550e8400-e29b-41d4-a716-446655440001&page=1&limit=10"
```

**Example Request (filter by creditNoteId):**

```bash
curl "http://localhost:3000/orgs/org-default/payments?creditNoteId=660e8400-e29b-41d4-a716-446655550001&page=1&limit=10"
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
      "clientAccumulatedDebtAtRecord": 2500,
      "clientCreditLimitAtRecord": 50000,
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

> **Note:** `clientId` and `creditNoteId` filters use their respective DynamoDB GSIs (`clientIdIndex` and `creditNoteIdIndex`) for efficient lookup. Both can be combined with `status`, `method`, `search`, `sortBy`, and `sortOrder`.

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
  "clientAccumulatedDebtAtRecord": 2500,
  "clientCreditLimitAtRecord": 50000,
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

**Note:** The response includes `clientAccumulatedDebtAtRecord` (the client's accumulated debt after this payment was processed). This is an audit/history field automatically populated by the system and should not be included in requests.

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
  "clientAccumulatedDebtAtRecord": 2500,
  "clientCreditLimitAtRecord": 50000,
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
  "clientAccumulatedDebtAtRecord": 2500,
  "clientCreditLimitAtRecord": 50000,
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
| `status` | String | Status: `pending`, `partial`, `paid`, or `overdue` | Auto-updated based on payment status and due date |
| `statusGSI` | String | Copy of status for GSI queries | For status-based filtering |
| `dueDate` | String | ISO 8601 timestamp | Payment/application due date |
| `description` | String | Reason or notes for the credit | Optional |
| `clientAccumulatedDebtAtRecord` | Number | Client's accumulated debt after transaction | Audit/history field |
| `clientCreditLimitAtRecord` | Number | Client's credit limit at transaction time | Audit/history field |
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
  "clientAccumulatedDebtAtRecord": 5000,
  "clientCreditLimitAtRecord": 50000,
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
| `clientAccumulatedDebtAtRecord` | Number | Client's accumulated debt after transaction | Audit/history field |
| `clientCreditLimitAtRecord` | Number | Client's credit limit at transaction time | Audit/history field |
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
- **accumulatedDebt**: Optional (update only), non-negative number (cannot exceed `creditLimit`)
- **notes**: Optional string

### Credit Note Validation Rules

- **clientId**: Required, must be a valid UUID referencing an existing Client
- **invoiceNumber**: Required, non-empty string
- **amount**: Required, positive number (> 0)
- **status**: Optional, one of: `pending`, `partial`, `paid`, `overdue` (default: `pending`)
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

## Credit Usage Metrics

### Overview

The Credit Usage module calculates and tracks the percentage of credit utilized by each organization. It monitors how much of the total available credit limit is being used by active clients across an organization, providing key business intelligence metrics.

**Formula:**
```
Credit Used Percentage = (Total Accumulated Debt / Total Credit Limit) × 100
```

### Metrics Table

A dedicated DynamoDB table stores credit usage records:

- **Table Name**: `metrics-{stage}` (e.g., `metrics-dev`, `metrics-prod`)
- **Billing Mode**: PAY_PER_REQUEST (serverless, scales automatically)
- **Partition Key (PK)**: `CreditUsed#{orgId}` — Enables per-organization queries
- **Sort Key (SK)**: `YYYY-MM-DD` — ISO date format for daily snapshots

### Record Structure

Each metrics record contains:

| Field | Type | Description |
|-------|------|-------------|
| `PK` | string | Partition key: `CreditUsed#{orgId}` |
| `SK` | string | Sort key: Date in `YYYY-MM-DD` format |
| `orgId` | string | Organization ID |
| `value` | number | Credit usage percentage (0-100, max 2 decimals) |
| `totalAccumulatedDebt` | number | Sum of all accumulated debt from active clients |
| `totalCreditLimit` | number | Sum of all credit limits from active clients |
| `activeClientsCount` | number | Number of active clients included in calculation |
| `createdAt` | string | ISO 8601 timestamp when record was created |
| `updatedAt` | string | ISO 8601 timestamp when record was last updated |

**Example Record:**
```json
{
  "PK": "CreditUsed#org-default",
  "SK": "2025-05-13",
  "orgId": "org-default",
  "value": 45.50,
  "totalAccumulatedDebt": 227500,
  "totalCreditLimit": 500000,
  "activeClientsCount": 25,
  "createdAt": "2025-05-13T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

### Calculation Process

The credit usage calculation includes the following logic:

1. **Active Clients Only**: Query all clients with `status = "active"` for the organization
2. **Aggregate Totals**:
   - Sum all `accumulatedDebt` values
   - Sum all `creditLimit` values
   - Count active clients
3. **Calculate Percentage**: `(totalAccumulatedDebt / totalCreditLimit) × 100`
   - If `totalCreditLimit = 0`, percentage defaults to `0`
   - Results are rounded to 2 decimal places
4. **Store Record**: Save calculated metrics to the metrics table with today's date as the SK

### Execution Modes

The credit usage calculation runs in **two modes**:

#### 1. Scheduled Execution (Daily)

**Trigger**: EventBridge cron schedule every 24 hours at 0:00 UTC  
**Cron Expression**: `cron(0 0 * * ? *)`  
**Function Name**: `calculateCreditUsageScheduled`

- Automatically processes all organizations specified in the `ORG_IDS` environment variable
- Creates a daily snapshot at midnight UTC
- Non-blocking and does not affect API responses

**Configuration in serverless.yml:**
```yaml
calculateCreditUsageScheduled:
  handler: src/functions/credit-usage/handler.scheduleHandler
  events:
    - schedule:
        rate: cron(0 0 * * ? *)
        input:
          orgIds: ${env:ORG_IDS}
```

**Environment Variable:**
```env
ORG_IDS=org-default,org-partner1,org-partner2
```

#### 2. Event-Driven Execution (Real-time)

**Triggers**: Automatically invoked after any of these operations:
- Credit note created, updated, or deleted
- Payment created, updated, or deleted

**Function Name**: `calculateCreditUsageEvent`

- Asynchronous Lambda-to-Lambda invocation
- Recalculates metrics immediately when debt changes
- Does not block the API response (fire-and-forget)

**How It Works:**
1. When a credit note or payment is modified, the API handler completes the transaction
2. After success, the handler calls `triggerCreditUsageCalculation(orgId)` 
3. This invokes the credit usage Lambda asynchronously
4. The event handler updates the current day's metrics record

### Obtaining Metrics

#### Getting the Latest Metric for an Organization

To retrieve the most recent credit usage metric, query the metrics table:

**Query Parameters:**
- **PK**: `CreditUsed#{orgId}`
- **ScanIndexForward**: `false` (descending order to get latest first)
- **Limit**: `1`

**DynamoDB Query Example (using AWS SDK):**
```javascript
const result = await ddb.send(
  new QueryCommand({
    TableName: 'metrics-dev',
    KeyConditionExpression: 'PK = :pk',
    ExpressionAttributeValues: {
      ':pk': 'CreditUsed#org-default',
    },
    ScanIndexForward: false,
    Limit: 1,
  }),
);
const latestMetric = result.Items?.[0];
```

**Expected Response:**
```json
{
  "PK": "CreditUsed#org-default",
  "SK": "2025-05-13",
  "orgId": "org-default",
  "value": 45.50,
  "totalAccumulatedDebt": 227500,
  "totalCreditLimit": 500000,
  "activeClientsCount": 25,
  "createdAt": "2025-05-13T00:00:00.000Z",
  "updatedAt": "2025-05-13T00:00:00.000Z"
}
```

#### Getting Historical Metrics for a Date Range

To retrieve multiple metrics across dates, use a date range query:

**Query Parameters:**
- **PK**: `CreditUsed#{orgId}`
- **SK Between**: `YYYY-MM-DD` range (e.g., `2025-05-01` to `2025-05-31`)

**DynamoDB Query Example:**
```javascript
const result = await ddb.send(
  new QueryCommand({
    TableName: 'metrics-dev',
    KeyConditionExpression: 'PK = :pk AND SK BETWEEN :startDate AND :endDate',
    ExpressionAttributeValues: {
      ':pk': 'CreditUsed#org-default',
      ':startDate': '2025-05-01',
      ':endDate': '2025-05-31',
    },
  }),
);
const metrics = result.Items; // Array of records sorted by date ascending
```

### Implementation Details

#### Source Code Structure

```
src/functions/credit-usage/
├── handler.ts          # Main Lambda handlers (scheduled and event-driven)
├── repository.ts       # DynamoDB queries and data operations
├── types.ts            # TypeScript interfaces for metrics
└── validators.ts       # Input validation (if needed)

src/functions/shared/
└── credit-usage-trigger.ts  # Utility to invoke credit-usage Lambda
```

#### Key Functions

**handler.ts:**
- `calculateCreditUsageForOrg(orgId)` — Main calculation function
- `scheduleHandler(event)` — EventBridge scheduled trigger handler
- `eventDrivenHandler(event)` — Lambda invocation handler

**repository.ts:**
- `getActiveClientsForOrg(orgId)` — Queries active clients from clients table
- `calculateCreditUsage(orgId)` — Computes percentage and totals
- `saveCreditUsageRecord(orgId, usage)` — Stores result in metrics table
- `getLatestCreditUsage(orgId)` — Retrieves most recent record

**shared/credit-usage-trigger.ts:**
- `triggerCreditUsageCalculation(orgId)` — Asynchronously invokes event-driven handler

#### Integration with Existing Modules

**Credit Notes Handler** (`src/functions/credit-notes/handler.ts`):
- After `POST /credit-notes` (create) → Triggers calculation
- After `PUT /credit-notes/{id}` (update) → Triggers calculation
- After `DELETE /credit-notes/{id}` (delete) → Triggers calculation

**Payments Handler** (`src/functions/payments/handler.ts`):
- After `POST /payments` (create) → Triggers calculation
- After `PUT /payments/{id}` (update) → Triggers calculation
- After `DELETE /payments/{id}` (delete) → Triggers calculation

#### Environment Variables

Add to `.env`:
```env
TABLE_METRICS=metrics
ORG_IDS=org-default,org-partner1
```

| Variable | Description |
|----------|-------------|
| `TABLE_METRICS` | Base name for metrics table (stage is appended) |
| `ORG_IDS` | Comma-separated organization IDs for scheduled trigger |

### First Metric Generation

#### When Is the First Metric Created?

The first metric is generated automatically in one of these scenarios:

1. **Scheduled Trigger** (Recommended): The EventBridge schedule runs at 0:00 UTC every day. The first metric appears at the next scheduled execution after deployment.

2. **Event-Driven Trigger**: Creating the first credit note or payment for an organization immediately triggers calculation, creating the first metric record.

3. **Manual Trigger**: You can manually invoke the Lambda function with an event:
   ```json
   {
     "orgId": "org-default"
   }
   ```

#### First Metric Example Scenario

1. **Deploy** the application with EventBridge schedule enabled
2. **Create a Client** with credit limit (e.g., `creditLimit: 100000`)
   - Still no metric yet (schedule hasn't run)
3. **Create a Credit Note** (e.g., `amount: 25000`)
   - **Event-driven trigger fires immediately**
   - First metric is created with `value: 25.00`
4. **View the metric** by querying the metrics table for today's date

### Performance & Scalability

- **Query Performance**: O(1) lookup by date (partition key + sort key)
- **Write Performance**: O(1) put operation per organization per day
- **Multi-tenancy**: Each organization has isolated metric records via partition key
- **No Indexes Required**: Daily snapshots are accessed directly via keys
- **Metrics Table Growth**: One record per organization per day (~365 records/year per org)

---

## Implementation Notes

### Backward Compatibility

The system maintains backward compatibility with legacy `balance` field by mapping it to `accumulatedDebt` in read operations. Any old records with `balance` will be treated as `accumulatedDebt`.

### Multi-Tenancy

All tables use organization-scoped partition keys (`org#<orgId>`) to ensure complete data isolation between organizations. Query operations are scoped to a single organization's partition for security and performance.

### Scalability

Using PAY_PER_REQUEST billing mode ensures the system scales automatically with demand without capacity planning. The single-table design with composite keys enables efficient queries and future feature additions.
