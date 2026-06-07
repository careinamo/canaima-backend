# Mejoras de Validación de Organización

Este documento rastrea las mejoras de seguridad relacionadas con la validación de acceso a organizaciones.

## ✅ Completadas

### 1. Validación de orgId en handlers (2026-06-07)

**Problema:** Un usuario autenticado en `org_A` podía acceder a recursos de `org_B` haciendo requests a `/orgs/org_B/...`.

**Solución:** Se agregó validación `requireOrgAccess(event, orgId)` en todos los handlers que reciben un `orgId` en el path.

**Archivos modificados:**

- `src/functions/shared/auth.ts` - Agregadas funciones helper:
  - `forbiddenResponse()` - Respuesta 403 estándar
  - `requireOrgAccess(event, orgId)` - Valida acceso y retorna 403 si no corresponde

- `src/functions/clients/handler.ts` - Validación en:
  - `listClients`
  - `getClient`
  - `createClient`
  - `updateClient`
  - `deleteClient`
  - `bulkImportClients`

- `src/functions/credit-notes/handler.ts` - Validación en:
  - `listCreditNotes`
  - `getCreditNote`
  - `createCreditNote`
  - `updateCreditNote`
  - `deleteCreditNote`
  - `checkExpirationManual`
  - `getExpirationRuleStatus`

- `src/functions/payments/handler.ts` - Validación en:
  - `listPayments`
  - `getPayment`
  - `createPayment`
  - `updatePayment`
  - `deletePayment`

- `src/functions/organizations/handler.ts` - Validación en:
  - `getOrganization`
  - `updateOrganization`
  - `listOrganizationMembers`
  - `completeOnboarding`

**Patrón de implementación:**
```typescript
import { requireOrgAccess } from '../shared/auth';

// Al inicio del handler, después de validar que orgId existe:
const accessDenied = requireOrgAccess(event, orgId);
if (accessDenied) return accessDenied;
```

---

## 🔄 Pendientes

### 2. Validación de roles dentro de la organización

**Descripción:** Actualmente solo se valida que el usuario pertenezca a la org, pero no se validan roles (admin, member, viewer).

**Posibles mejoras:**
- Solo admins pueden eliminar recursos
- Solo admins pueden hacer bulk imports
- Viewers solo pueden listar/ver, no crear/modificar

**Archivos a modificar:**
- `src/functions/shared/auth.ts` - Agregar `requireOrgRole(event, orgId, roles[])`
- Todos los handlers que requieran roles específicos

---

### 3. Auditoría de accesos denegados

**Descripción:** Registrar en CloudWatch o DynamoDB los intentos de acceso denegado para detectar actividad sospechosa.

**Implementación sugerida:**
- Crear función `logAccessDenied(userId, attemptedOrgId, actualOrgId)`
- Llamarla en `forbiddenResponse()`
- Considerar alarmas CloudWatch para patrones de ataque

---

### 4. Rate limiting por organización

**Descripción:** Limitar requests por organización para prevenir abuso.

**Implementación sugerida:**
- Usar API Gateway throttling por orgId
- O implementar rate limiting custom con DynamoDB/Redis

---

### 5. Validación de recursos cross-organization

**Descripción:** Validar que recursos referenciados (ej: clientId en creditNote) pertenezcan a la misma organización.

**Casos a validar:**
- `createCreditNote` - verificar que `clientId` pertenece al mismo `orgId`
- `createPayment` - verificar que `clientId` y `creditNoteId` pertenecen al mismo `orgId`

---

## Notas

- La validación usa el `orgId` del JWT (claim `o.id`) comparado con el `orgId` del path
- En desarrollo local, se usa bypass con headers `X-Dev-Org-Id`
- El authorizer inyecta el contexto en `event.requestContext.authorizer.lambda`
