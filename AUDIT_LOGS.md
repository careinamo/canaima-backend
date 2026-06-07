# Sistema de Audit Logs

El sistema de audit logs registra todas las operaciones de creación, actualización y eliminación de recursos en la plataforma. Los logs se almacenan en DynamoDB y se pueden consultar por organización.

## Arquitectura

### Tabla DynamoDB

**Nombre:** `audit-logs-{stage}` (ej: `audit-logs-dev`, `audit-logs-prod`)

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `orgId` | String (PK) | ID de la organización (Clerk org ID) |
| `sk` | String (SK) | Sort key: `{timestamp}#{eventId}` para ordenamiento por fecha |
| `eventId` | String | ID único del evento (formato: `evt_xxxxxxxx`) |
| `userId` | String | ID del usuario que realizó la acción |
| `gsi1pk` | String | GSI key para filtrar por usuario: `{orgId}#{userId}` |
| `action` | String | Tipo de acción: `CREATE`, `UPDATE`, `DELETE` |
| `resourceType` | String | Tipo de recurso: `client`, `credit-note`, `payment`, `organization` |
| `resourceId` | String | ID del recurso afectado |
| `resourceName` | String? | Nombre del recurso (opcional) |
| `timestamp` | String | Fecha ISO 8601 del evento |
| `ipAddress` | String? | Dirección IP del cliente |
| `userAgent` | String? | User-Agent del navegador |
| `metadata` | Object? | Datos adicionales específicos de la acción |
| `ttl` | Number | Unix timestamp para auto-eliminación (90 días) |

### Índices

1. **Primary Index:** `orgId` (PK) + `sk` (SK)
   - Permite consultas por organización ordenadas por fecha

2. **GSI `byUser`:** `gsi1pk` (PK) + `sk` (SK)
   - Permite filtrar eventos por usuario específico dentro de una org

### TTL

Los registros se eliminan automáticamente después de **90 días** para mantener el tamaño de la tabla manejable.

## API

### GET /orgs/{orgId}/audit-logs

Lista los eventos de auditoría de una organización.

**Autenticación:** Requiere token JWT de Clerk con acceso a la organización.

**Query Parameters:**

| Parámetro | Tipo | Default | Descripción |
|-----------|------|---------|-------------|
| `userId` | String | - | Filtrar por usuario específico |
| `startDate` | String | - | Fecha inicio (YYYY-MM-DD o ISO 8601) |
| `endDate` | String | - | Fecha fin (YYYY-MM-DD o ISO 8601) |
| `action` | String | - | Filtrar por acción: `CREATE`, `UPDATE`, `DELETE` |
| `resourceType` | String | - | Filtrar por tipo: `client`, `credit-note`, `payment`, `organization` |
| `resourceId` | String | - | Filtrar por recurso específico |
| `page` | Number | 1 | Número de página |
| `limit` | Number | 50 | Items por página (max: 100) |
| `sortOrder` | String | desc | Orden: `asc` (más antiguos primero) o `desc` (más recientes primero) |

**Respuesta:**

```json
{
  "data": [
    {
      "eventId": "evt_a1b2c3d4",
      "userId": "user_xxx",
      "action": "CREATE",
      "resourceType": "client",
      "resourceId": "cl_abc123",
      "resourceName": "Juan Pérez",
      "timestamp": "2026-06-07T15:30:45.123Z",
      "ipAddress": "190.15.23.45",
      "userAgent": "Mozilla/5.0...",
      "metadata": {
        "email": "juan@example.com",
        "phone": "+58 412 1234567"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "totalPages": 3,
    "totalCount": 125,
    "hasMore": true
  }
}
```

**Ejemplos:**

```bash
# Últimos 50 eventos
GET /orgs/org_xxx/audit-logs

# Eventos de un usuario específico
GET /orgs/org_xxx/audit-logs?userId=user_abc

# Eventos de la última semana
GET /orgs/org_xxx/audit-logs?startDate=2026-06-01&endDate=2026-06-07

# Solo eliminaciones de clientes
GET /orgs/org_xxx/audit-logs?action=DELETE&resourceType=client

# Historial de un recurso específico
GET /orgs/org_xxx/audit-logs?resourceType=credit-note&resourceId=cn_xyz789
```

## Uso en Handlers

### Función Helper

El helper `logAuditEvent` se usa para registrar eventos después de operaciones exitosas.

```typescript
import { logAuditEvent } from '../shared/audit-logger';

// Después de crear un cliente:
const client = await repo.createClient(orgId, input);
logAuditEvent(event, 'CREATE', 'client', client.id, client.name, {
  email: client.email,
  phone: client.phone,
});
```

### Parámetros de `logAuditEvent`

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `event` | APIGatewayProxyEventV2 | Evento de Lambda (contiene headers y auth) |
| `action` | `'CREATE'` \| `'UPDATE'` \| `'DELETE'` | Tipo de acción |
| `resourceType` | `'client'` \| `'credit-note'` \| `'payment'` \| `'organization'` | Tipo de recurso |
| `resourceId` | String | ID del recurso afectado |
| `resourceName` | String? | Nombre del recurso (opcional) |
| `metadata` | Object? | Datos adicionales (opcional) |

### Comportamiento

- **Fire-and-forget:** La función no bloquea la respuesta. El log se envía de forma asíncrona.
- **Fallos silenciosos:** Si el logging falla, se registra un warning en CloudWatch pero no afecta la operación principal.
- **Extracción automática:** IP, User-Agent, userId y orgId se extraen automáticamente del evento.

### Versión Síncrona

Para casos donde necesitas garantizar que el log se escribió (ej: antes de una eliminación):

```typescript
import { logAuditEventSync } from '../shared/audit-logger';

await logAuditEventSync(event, 'DELETE', 'client', clientId);
```

## Recursos Integrados

El sistema de audit logs está integrado en los siguientes handlers:

| Handler | Acciones Registradas |
|---------|---------------------|
| **clients** | CREATE, UPDATE, DELETE, bulk-import |
| **credit-notes** | CREATE, UPDATE, DELETE |
| **payments** | CREATE, UPDATE, DELETE |
| **organizations** | CREATE, UPDATE (incluyendo complete-onboarding) |

## Metadata por Tipo de Acción

### CREATE
- `email`, `phone`, `creditLimit` (clients)
- `clientId`, `amount`, `dueDate`, `concept` (credit-notes)
- `clientId`, `creditNoteId`, `amount`, `method` (payments)
- `teamSize`, `currency` (organizations)

### UPDATE
- `updatedFields`: Array con los nombres de los campos modificados

### DELETE
- `clientId` (credit-notes)
- Ningún metadata adicional (clients, payments)

### Bulk Import
- `createdCount`: Número de registros creados
- `failedCount`: Número de registros fallidos
- `clientIds`: Array con IDs de clientes creados

## Estructura de Archivos

```
src/functions/audit-logs/
├── types.ts       # Tipos TypeScript
├── repository.ts  # Operaciones DynamoDB
└── handler.ts     # Endpoint HTTP

src/functions/shared/
└── audit-logger.ts  # Helper para logging
```

## Variables de Entorno

| Variable | Descripción |
|----------|-------------|
| `TABLE_AUDIT_LOGS` | Nombre de la tabla DynamoDB |

## Consideraciones

1. **Retención:** Los logs se eliminan automáticamente después de 90 días vía TTL de DynamoDB.

2. **Privacidad:** No se almacena información sensible (contraseñas, tokens) en los logs.

3. **Performance:** El logging es asíncrono para no afectar la latencia de las operaciones.

4. **Acceso:** Solo usuarios con acceso a la organización pueden ver sus audit logs.

5. **Capacidad:** Se usa provisioned capacity en producción; on-demand en dev.

## Roadmap

- [ ] Exportar logs a CSV/JSON
- [ ] Filtros avanzados (múltiples usuarios, tipos de recurso)
- [ ] Notificaciones por operaciones críticas (eliminaciones masivas)
- [ ] Integración con servicios externos (DataDog, CloudWatch Insights)
- [ ] Dashboard de actividad en el frontend
