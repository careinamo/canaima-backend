# Canaima Backend - Real-Time Notifications System

## Overview

The Canaima Backend provides a real-time notifications system using **API Gateway WebSocket** and **DynamoDB**. This system enables instant delivery of notifications to connected users while maintaining a persistent history for offline access.

---

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Frontend  │────▶│  API Gateway     │────▶│  Lambda         │
│   (Browser) │     │  WebSocket       │     │  Handlers       │
└─────────────┘     └──────────────────┘     └────────┬────────┘
       ▲                                              │
       │                                              ▼
       │           ┌──────────────────────────────────────────┐
       │           │              DynamoDB                    │
       └───────────│  ┌─────────────────┐ ┌─────────────────┐ │
                   │  │ Notifications   │ │ Connections     │ │
                   │  │ Table           │ │ Table           │ │
                   │  └─────────────────┘ └─────────────────┘ │
                   └──────────────────────────────────────────┘
```

---

## 1. WebSocket URL (per Environment)

| Environment | WebSocket URL |
|-------------|---------------|
| **dev** | `wss://{api-id}.execute-api.us-west-2.amazonaws.com/dev` |
| **prod** | `wss://{api-id}.execute-api.us-east-1.amazonaws.com/prod` |

> **Note:** The actual `{api-id}` is generated after deployment. You can retrieve it from the CloudFormation Outputs:
> - `WebSocketApiEndpoint` - Full WebSocket URL
> - `WebSocketApiId` - The API ID

**After deployment, run:**
```bash
serverless info --stage dev
```

Look for `WebsocketsApiUrl` in the output.

---

## 2. Authentication Flow

### Connection Authentication

API Gateway WebSocket does **not** support Authorization headers. Authentication is performed via **JWT token in the query string**.

**Connection URL format:**
```
wss://{websocket-url}?token={jwt_token}
```

**Example:**
```javascript
const jwt = await clerk.session.getToken();
const ws = new WebSocket(`wss://abc123.execute-api.us-west-2.amazonaws.com/dev?token=${jwt}`);
```

### Token Validation

1. The `$connect` Lambda extracts the token from `queryStringParameters.token`
2. Validates the JWT against Clerk's JWKS endpoint
3. Extracts `userId` from the `sub` claim
4. Extracts `orgId` from the `org_id` claim (if present)
5. Stores the connection in DynamoDB with the userId association

**If authentication fails:**
- Connection is rejected with status code `401`
- No entry is created in the connections table

---

## 3. WebSocket Events (Server → Client)

### Message Format

All messages follow this structure:

```typescript
interface WebSocketMessage<T> {
  type: WebSocketEventType;
  payload: T;
  timestamp: string; // ISO 8601
}
```

### Event Types

#### `connection_ack` - Connection Confirmation
Sent immediately after successful connection.

```json
{
  "type": "connection_ack",
  "payload": {
    "connectionId": "abc123xyz",
    "userId": "user_2abc123",
    "serverTime": "2026-06-22T14:30:00.000Z",
    "heartbeatIntervalMs": 300000
  },
  "timestamp": "2026-06-22T14:30:00.000Z"
}
```

#### `notification` - New Notification
Sent when a new notification is created for the user.

```json
{
  "type": "notification",
  "payload": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "userId": "user_2abc123",
    "orgId": "org_xyz789",
    "type": "credit_note_created",
    "priority": "normal",
    "title": "Nueva nota de crédito",
    "message": "Se creó una nota de crédito para ACME Corp por USD 5,000",
    "read": false,
    "link": "/orgs/org_xyz789/credit-notes/550e8400",
    "resourceType": "credit-note",
    "resourceId": "550e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "clientName": "ACME Corp",
      "amount": 5000,
      "currency": "USD"
    },
    "createdAt": "2026-06-22T14:30:00.000Z"
  },
  "timestamp": "2026-06-22T14:30:00.000Z"
}
```

**Notification Types:**
| Type | Description | Priority |
|------|-------------|----------|
| `credit_note_created` | New credit note created | normal |
| `credit_note_updated` | Credit note modified | normal |
| `credit_note_deleted` | Credit note removed | normal |
| `credit_note_expired` | Credit note is overdue | high |
| `credit_note_paid` | Credit note fully paid | normal |
| `payment_created` | New payment received | normal |
| `payment_updated` | Payment modified | normal |
| `payment_deleted` | Payment removed | normal |
| `client_created` | New client added | normal |
| `client_delinquent` | Client marked as delinquent | high |
| `report_ready` | Report is ready for download | normal |
| `org_invite` | Organization invitation | normal |
| `system` | System notification | varies |

#### `notification_read` - Notification Marked as Read
Broadcast to all user's connections when a notification is marked as read.

```json
{
  "type": "notification_read",
  "payload": {
    "notificationId": "550e8400-e29b-41d4-a716-446655440000",
    "readAt": "2026-06-22T14:35:00.000Z"
  },
  "timestamp": "2026-06-22T14:35:00.000Z"
}
```

#### `notifications_read_all` - All Notifications Marked as Read

```json
{
  "type": "notifications_read_all",
  "payload": {
    "count": 15,
    "orgId": "org_xyz789",
    "readAt": "2026-06-22T14:35:00.000Z"
  },
  "timestamp": "2026-06-22T14:35:00.000Z"
}
```

#### `notification_deleted` - Notification Deleted

```json
{
  "type": "notification_deleted",
  "payload": {
    "notificationId": "550e8400-e29b-41d4-a716-446655440000"
  },
  "timestamp": "2026-06-22T14:36:00.000Z"
}
```

#### `heartbeat` - Server Ping Response

```json
{
  "type": "heartbeat",
  "payload": {
    "serverTime": "2026-06-22T14:40:00.000Z"
  },
  "timestamp": "2026-06-22T14:40:00.000Z"
}
```

#### `error` - Error Message

```json
{
  "type": "error",
  "payload": {
    "code": "INVALID_JSON",
    "message": "Invalid JSON message"
  },
  "timestamp": "2026-06-22T14:30:00.000Z"
}
```

**Error Codes:**
| Code | Description |
|------|-------------|
| `INVALID_JSON` | Message body is not valid JSON |
| `UNKNOWN_ACTION` | Unknown action type |
| `MISSING_NOTIFICATION_ID` | notificationId required but not provided |
| `NOTIFICATION_NOT_FOUND` | Notification doesn't exist or belongs to another user |

---

## 4. REST API Endpoints for Notifications

All endpoints require authentication via Clerk JWT in the `Authorization` header.

### Base URL
```
https://{api-gateway-id}.execute-api.{region}.amazonaws.com/{stage}
```

### Endpoints

#### GET `/notifications` - List Notifications

**Query Parameters:**
| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 20 | Items per page (max: 100) |
| `sortOrder` | string | desc | `asc` or `desc` |
| `unreadOnly` | boolean | false | Filter to unread only |
| `orgId` | string | - | Filter by organization |

**Response (200):**
```json
{
  "items": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "userId": "user_2abc123",
      "orgId": "org_xyz789",
      "type": "credit_note_created",
      "priority": "normal",
      "title": "Nueva nota de crédito",
      "message": "Se creó una nota de crédito para ACME Corp por USD 5,000",
      "read": false,
      "link": "/orgs/org_xyz789/credit-notes/550e8400",
      "resourceType": "credit-note",
      "resourceId": "550e8400-e29b-41d4-a716-446655440000",
      "createdAt": "2026-06-22T14:30:00.000Z"
    }
  ],
  "total": 150,
  "unreadCount": 12,
  "pagination": {
    "page": 1,
    "limit": 20,
    "totalPages": 8,
    "totalCount": 150,
    "hasMore": true
  }
}
```

#### GET `/notifications/{id}` - Get Single Notification

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "userId": "user_2abc123",
  "orgId": "org_xyz789",
  "type": "credit_note_created",
  "priority": "normal",
  "title": "Nueva nota de crédito",
  "message": "Se creó una nota de crédito para ACME Corp por USD 5,000",
  "read": true,
  "readAt": "2026-06-22T14:35:00.000Z",
  "link": "/orgs/org_xyz789/credit-notes/550e8400",
  "createdAt": "2026-06-22T14:30:00.000Z"
}
```

#### PATCH `/notifications/{id}/read` - Mark as Read

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "read": true,
  "readAt": "2026-06-22T14:35:00.000Z",
  ...
}
```

#### PATCH `/notifications/read-all` - Mark All as Read

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Optional: only mark for specific org |

**Response (200):**
```json
{
  "success": true,
  "message": "Marked 15 notification(s) as read",
  "count": 15
}
```

#### DELETE `/notifications/{id}` - Delete Notification

**Response (200):**
```json
{
  "success": true,
  "message": "Notification deleted"
}
```

#### GET `/notifications/unread-count` - Get Unread Count

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `orgId` | string | Optional: filter by organization |

**Response (200):**
```json
{
  "unreadCount": 12
}
```

---

## 5. WebSocket Connection Lifecycle

### Timeouts

| Timeout | Duration | Description |
|---------|----------|-------------|
| Idle timeout | 10 minutes | AWS API Gateway disconnects idle connections |
| Connection timeout | 2 hours | Maximum connection duration |
| TTL cleanup | 24 hours | Stale connections removed from DynamoDB |

### Heartbeat

**Client should send a heartbeat every 5 minutes** to prevent idle disconnection:

```json
{"action": "heartbeat"}
```

Server responds with:
```json
{
  "type": "heartbeat",
  "payload": {"serverTime": "2026-06-22T14:40:00.000Z"},
  "timestamp": "2026-06-22T14:40:00.000Z"
}
```

### Reconnection Strategy

**Recommended: Exponential backoff with jitter**

```javascript
const INITIAL_DELAY = 1000;
const MAX_DELAY = 30000;
const MAX_RETRIES = 10;

let retryCount = 0;

function reconnect() {
  if (retryCount >= MAX_RETRIES) {
    console.error('Max retries reached');
    return;
  }
  
  const delay = Math.min(
    INITIAL_DELAY * Math.pow(2, retryCount) + Math.random() * 1000,
    MAX_DELAY
  );
  
  setTimeout(() => {
    retryCount++;
    connect();
  }, delay);
}
```

### Accumulated Notifications

When a user reconnects, they should fetch accumulated notifications via the REST API:

```javascript
ws.onopen = async () => {
  // Fetch unread notifications accumulated while offline
  const response = await fetch('/notifications?unreadOnly=true&limit=50');
  const data = await response.json();
  displayNotifications(data.items);
};
```

---

## 6. Client-to-Server Actions

All messages must include an `action` field:

```typescript
interface WebSocketClientMessage {
  action: 'heartbeat' | 'markRead' | 'markAllRead' | 'subscribe';
  notificationId?: string;
  orgId?: string;
}
```

### Available Actions

#### `heartbeat` - Keep Connection Alive

```json
{"action": "heartbeat"}
```

#### `markRead` - Mark Notification as Read

```json
{
  "action": "markRead",
  "notificationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

Broadcasts `notification_read` to all user's connections.

#### `markAllRead` - Mark All as Read

```json
{
  "action": "markAllRead",
  "orgId": "org_xyz789"
}
```

`orgId` is optional. If omitted, marks all user's notifications as read.

#### `subscribe` - Subscribe to Updates

```json
{"action": "subscribe"}
```

Returns a `connection_ack` message.

---

## 7. WebSocket Close Codes

| Code | Meaning | Action |
|------|---------|--------|
| `1000` | Normal closure | Reconnect if needed |
| `1001` | Going away | Reconnect |
| `1006` | Abnormal closure | Reconnect with backoff |
| `1008` | Policy violation (auth failed) | Refresh token and reconnect |
| `1011` | Server error | Reconnect with backoff |

**Token Expiration:**
If the JWT expires during an active connection, the connection will close with code `1008`. Refresh the token and reconnect.

---

## 8. Multiple Tabs Strategy

Each browser tab creates its own WebSocket connection. All connections for the same user receive the same messages.

**Recommended behavior:**
1. Each tab maintains its own connection
2. When one tab marks a notification as read, all tabs receive `notification_read` event
3. Update UI across all tabs simultaneously

**Alternative (advanced):**
Use `BroadcastChannel` API to share a single connection:

```javascript
const channel = new BroadcastChannel('notifications');
let isLeader = false;

// Leader election - only one tab maintains WebSocket
channel.onmessage = (event) => {
  if (event.data.type === 'notification') {
    displayNotification(event.data.payload);
  }
};
```

---

## 9. Payload Size Limits

| Limit | Value |
|-------|-------|
| Message payload | 128 KB |
| Connection data | 128 KB |
| API Gateway limit | 128 KB per frame |

Keep notification messages concise. Use `link` to reference detailed data.

---

## 10. Complete Frontend Integration Example

```javascript
class NotificationService {
  constructor(getToken) {
    this.getToken = getToken;
    this.ws = null;
    this.listeners = new Set();
    this.retryCount = 0;
    this.heartbeatInterval = null;
  }

  async connect() {
    const token = await this.getToken();
    const wsUrl = `wss://abc123.execute-api.us-west-2.amazonaws.com/dev?token=${token}`;
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.retryCount = 0;
      this.startHeartbeat();
      this.fetchUnreadNotifications();
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onclose = (event) => {
      console.log('WebSocket closed:', event.code, event.reason);
      this.stopHeartbeat();
      
      if (event.code === 1008) {
        // Token expired - refresh and reconnect
        this.connect();
      } else {
        this.reconnectWithBackoff();
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }
  
  handleMessage(message) {
    switch (message.type) {
      case 'connection_ack':
        console.log('Connection acknowledged:', message.payload);
        break;
        
      case 'notification':
        this.notifyListeners('new', message.payload);
        break;
        
      case 'notification_read':
        this.notifyListeners('read', message.payload);
        break;
        
      case 'notifications_read_all':
        this.notifyListeners('readAll', message.payload);
        break;
        
      case 'notification_deleted':
        this.notifyListeners('deleted', message.payload);
        break;
        
      case 'heartbeat':
        // Connection is alive
        break;
        
      case 'error':
        console.error('Server error:', message.payload);
        break;
    }
  }
  
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: 'heartbeat' }));
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }
  
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }
  
  reconnectWithBackoff() {
    const delay = Math.min(1000 * Math.pow(2, this.retryCount), 30000);
    this.retryCount++;
    
    setTimeout(() => this.connect(), delay + Math.random() * 1000);
  }
  
  markAsRead(notificationId) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'markRead',
        notificationId
      }));
    }
  }
  
  markAllAsRead(orgId = null) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'markAllRead',
        ...(orgId && { orgId })
      }));
    }
  }
  
  async fetchUnreadNotifications() {
    const response = await fetch('/notifications?unreadOnly=true&limit=50', {
      headers: {
        'Authorization': `Bearer ${await this.getToken()}`
      }
    });
    const data = await response.json();
    this.notifyListeners('initial', data.items);
    return data;
  }
  
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  
  notifyListeners(event, data) {
    for (const listener of this.listeners) {
      listener(event, data);
    }
  }
  
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close(1000, 'User logout');
      this.ws = null;
    }
  }
}

// Usage with Clerk
const notificationService = new NotificationService(
  () => clerk.session.getToken()
);

// Connect when user logs in
notificationService.connect();

// Subscribe to updates
notificationService.subscribe((event, data) => {
  switch (event) {
    case 'new':
      showToast(data.title, data.message);
      updateBadgeCount();
      break;
    case 'read':
      updateNotificationItem(data.notificationId, { read: true });
      break;
    case 'readAll':
      updateAllNotifications({ read: true });
      break;
    case 'deleted':
      removeNotificationItem(data.notificationId);
      break;
    case 'initial':
      renderNotifications(data);
      break;
  }
});

// Disconnect on logout
clerk.addListener((event) => {
  if (event === 'signedOut') {
    notificationService.disconnect();
  }
});
```

---

## 11. Guaranteed Delivery

### Offline Users

Notifications are **always stored in DynamoDB**, regardless of whether the user is connected:

1. Notification is created in DynamoDB
2. System attempts WebSocket broadcast
3. If user is offline, notification waits in database
4. When user reconnects, fetch via REST API

### Multi-Device Sync

All connected devices receive the same notifications. Use the `notification_read` event to sync read status across devices.

---

## 12. Testing

### Test Notification Endpoint (Internal)

```bash
curl -X POST https://api.example.com/notifications \
  -H "Authorization: Bearer ${JWT}" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "user_2abc123",
    "type": "system",
    "title": "Test Notification",
    "message": "This is a test notification"
  }'
```

### WebSocket Test with wscat

```bash
# Install wscat
npm install -g wscat

# Connect
wscat -c "wss://abc123.execute-api.us-west-2.amazonaws.com/dev?token=${JWT}"

# Send heartbeat
{"action": "heartbeat"}

# Mark as read
{"action": "markRead", "notificationId": "550e8400-e29b-41d4-a716-446655440000"}
```

---

## DynamoDB Table Schemas

### Notifications Table

| Attribute | Type | Description |
|-----------|------|-------------|
| PK | String | `user#{userId}` |
| SK | String | `notification#{createdAt}#{id}` |
| GSI1PK | String | `org#{orgId}` (optional) |
| GSI1SK | String | `notification#{createdAt}#{id}` |
| id | String | UUID |
| userId | String | User ID |
| orgId | String | Organization ID (optional) |
| type | String | Notification type |
| priority | String | `low`, `normal`, `high`, `urgent` |
| title | String | Notification title |
| message | String | Notification body |
| read | Boolean | Read status |
| readAt | String | ISO 8601 timestamp |
| link | String | Deep link URL |
| resourceType | String | Related resource type |
| resourceId | String | Related resource ID |
| metadata | Map | Additional data |
| createdAt | String | ISO 8601 timestamp |
| expiresAt | String | ISO 8601 timestamp (optional) |
| ttl | Number | Unix timestamp for auto-deletion |

**Indexes:**
- Primary: `PK` (HASH) + `SK` (RANGE)
- GSI1 `byOrg`: `GSI1PK` (HASH) + `GSI1SK` (RANGE)

### WebSocket Connections Table

| Attribute | Type | Description |
|-----------|------|-------------|
| PK | String | `connection#{connectionId}` |
| SK | String | `connection#{connectionId}` |
| GSI1PK | String | `user#{userId}` |
| GSI1SK | String | `connection#{connectedAt}#{connectionId}` |
| connectionId | String | API Gateway connection ID |
| userId | String | User ID |
| connectedAt | String | ISO 8601 timestamp |
| lastPingAt | String | ISO 8601 timestamp |
| userAgent | String | Browser user agent |
| sourceIp | String | Client IP address |
| ttl | Number | Unix timestamp for auto-cleanup |

**Indexes:**
- Primary: `PK` (HASH) + `SK` (RANGE)
- GSI1 `byUser`: `GSI1PK` (HASH) + `GSI1SK` (RANGE)

---

## Environment Variables

Add these to your `.env` file:

```env
TABLE_NOTIFICATIONS_BASE=notifications
TABLE_WEBSOCKET_CONNECTIONS_BASE=websocket-connections
```

---

## Deployment

```bash
# Deploy to dev
serverless deploy --stage dev

# Get WebSocket URL
serverless info --stage dev

# Look for output:
# WebsocketsApiUrl: wss://abc123.execute-api.us-west-2.amazonaws.com/dev
```

---

## Frontend Prompt

Use this prompt for your frontend AI agent to implement the notifications UI:

---

```
Implementa un sistema de notificaciones en tiempo real para la aplicación Canaima. El backend ya está configurado con:

1. **WebSocket URL**: `wss://{api-id}.execute-api.{region}.amazonaws.com/{stage}?token={jwt}`
   - La autenticación se hace via JWT de Clerk en el query string
   - El token se obtiene con `clerk.session.getToken()`

2. **Eventos del servidor** (type en el mensaje JSON):
   - `connection_ack`: Confirmación de conexión exitosa
   - `notification`: Nueva notificación
   - `notification_read`: Notificación marcada como leída (sync entre pestañas)
   - `notifications_read_all`: Todas marcadas como leídas
   - `notification_deleted`: Notificación eliminada
   - `heartbeat`: Respuesta al ping
   - `error`: Error del servidor

3. **Formato de notificación**:
   ```json
   {
     "id": "uuid",
     "type": "credit_note_created|payment_created|client_delinquent|...",
     "priority": "normal|high|urgent",
     "title": "Título",
     "message": "Descripción",
     "read": false,
     "link": "/path/to/resource",
     "createdAt": "ISO8601"
   }
   ```

4. **Acciones del cliente** (enviar JSON con campo `action`):
   - `{"action": "heartbeat"}` - Enviar cada 5 minutos
   - `{"action": "markRead", "notificationId": "uuid"}`
   - `{"action": "markAllRead", "orgId": "optional"}`

5. **REST Endpoints** (con Authorization header):
   - `GET /notifications?unreadOnly=true&limit=20` - Listar
   - `PATCH /notifications/{id}/read` - Marcar leída
   - `PATCH /notifications/read-all` - Marcar todas leídas
   - `DELETE /notifications/{id}` - Eliminar
   - `GET /notifications/unread-count` - Contador

6. **Comportamiento requerido**:
   - Ícono de campanita con badge de conteo de no leídas
   - Dropdown con lista de notificaciones (scroll infinito)
   - Toast/snackbar cuando llega nueva notificación
   - Reconexión automática con backoff exponencial
   - Heartbeat cada 5 minutos para mantener conexión
   - Sincronización entre pestañas (cuando una marca leído, todas se actualizan)
   - Fetch inicial de notificaciones no leídas al conectar
   - Prioridad alta/urgente: badge rojo, sonido opcional

7. **Tipos de notificación a manejar**:
   - `credit_note_created/updated/deleted/expired/paid`
   - `payment_created/updated/deleted`
   - `client_created/client_delinquent`
   - `report_ready`
   - `system`

8. **Reconexión**:
   - Código 1008: Token expirado → Refrescar token y reconectar
   - Otros códigos: Backoff exponencial (1s, 2s, 4s, ... max 30s)

Implementa el servicio de notificaciones, los componentes UI (campanita, dropdown, toast), y los hooks de React necesarios.
```

---
