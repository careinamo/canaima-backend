# Canaima Backend - Clerk Integration Implementation Summary

## 📋 Resumen Ejecutivo

Se ha implementado exitosamente la integración de Clerk con el backend Canaima, incluyendo:
- ✅ Módulo de **Organizations** con gestión de miembros
- ✅ Módulo de **Users** con perfiles de usuario
- ✅ **JWT Authorizer** para validar tokens de Clerk
- ✅ **Webhook Handler** para sincronizar eventos de Clerk
- ✅ 3 nuevas tablas DynamoDB con GSI1 para queries eficientes
- ✅ Idempotencia en webhooks (24h TTL)
- ✅ Auth helpers y error handling unificado

**Commit Hash**: `05ad15e` (ver `git log`)

---

## 📁 Archivos Creados

### Módulo Organizations
```
src/functions/organizations/
├── handler.ts          (5 endpoints: GET, POST, PATCH organizations)
├── repository.ts       (8 funciones DynamoDB)
├── types.ts            (Interfaces TypeScript)
└── validators.ts       (Zod schemas)
```

**Endpoints**:
- `GET /users/me/organizations` - Listar orgs del usuario
- `GET /organizations/{orgId}` - Obtener detalles
- `POST /organizations` - Crear/upserta org
- `PATCH /organizations/{orgId}` - Actualizar (admin only)
- `GET /organizations/{orgId}/members` - Listar miembros

### Módulo Users
```
src/functions/users/
├── handler.ts          (3 endpoints: perfil de usuario)
├── repository.ts       (CRUD de perfil)
├── types.ts            (Interfaces)
└── validators.ts       (Zod schemas)
```

**Endpoints**:
- `GET /users/me` - Obtener perfil autenticado
- `PATCH /users/me` - Actualizar perfil
- `GET /users/{userId}` - Obtener perfil público

### Webhooks Clerk
```
src/functions/webhooks/clerk/
├── handler.ts          (Procesador de eventos - 9 tipos)
├── verify.ts           (Verificación Svix)
└── webhook-events.ts   (Idempotencia + TTL)
```

**Eventos Procesados**:
- `user.created`, `user.updated`, `user.deleted`
- `organization.created`, `organization.updated`, `organization.deleted`
- `organizationMembership.created`, `organizationMembership.updated`, `organizationMembership.deleted`

### Shared Utilities
```
src/functions/shared/
├── clerk-authorizer.ts (Lambda Authorizer - JWT validation + JWKS caching)
├── auth.ts             (Helper para extraer contexto auth)
└── errors.ts           (Clase HttpError + response helpers)
```

### Archivos de Configuración
```
serverless.yml         (ACTUALIZADO: +17 funciones, 3 tablas, authorizer)
package.json           (ACTUALIZADO: +4 dependencias: svix, jose, zod, uuid)
.env.example           (CREADO: plantilla de variables)
CLERK_SETUP.md         (CREADO: guía completa de setup)
```

---

## 🗄️ DynamoDB - Nuevas Tablas

### 1. `organizations-{stage}`

```
PK: ORG#{clerkOrgId}
SK: META | USER#{userId} | USER#{userId} | ...
GSI1PK: USER#{userId}  →  GSI1SK: ORG#{orgId}
```

**Contenido**:
- `META`: Metadata de la org (name, plan, currency, settings, createdBy, timestamps)
- `USER#{userId}`: Miembros con role (admin/member), status, joinedAt
- **GSI1**: Query rápida de "qué orgs tiene este usuario"

### 2. `users-{stage}`

```
PK: USER#{clerkUserId}
SK: PROFILE
```

**Contenido**: email, firstName, lastName, imageUrl, timestamps, lastSignInAt

### 3. `webhook-events-{stage}`

```
PK: WEBHOOK#CLERK
SK: {eventId}
TTL: 24h automático
```

**Uso**: Prevenir duplicados (idempotencia) en webhooks

---

## 🔐 Security & Authorization

### JWT Authorizer Flow

```
Request → Clerk JWT en header Authorization
       ↓
Lambda Authorizer (clerk-authorizer.ts)
  ├─ Descarga JWKS de Clerk
  ├─ Cachea por 1 hora
  ├─ Valida firma JWT
  ├─ Extrae claims: sub, org_id, org_role
       ↓
Inyecta en requestContext.authorizer.lambda
       ↓
Handler extrae con getAuth()
```

### Endpoints Sin Autorización
- `GET /hello` - Health check
- `POST /webhooks/clerk` - Usa verificación Svix (no JWT)

### Endpoints Protegidos
- Todos los `/organizations/*` 
- Todos los `/users/*` (excepto `/users/{userId}` es público pero desnormalizado)
- Todos los `/orgs/{orgId}/clients|credit-notes|payments`

---

## 📋 Checklist de Deployment

### Pre-deployment
- [ ] Instalar dependencias: `npm install`
- [ ] Compilar TypeScript: `npm run build` (si falla, revisar imports)
- [ ] Obtener Clerk credentials:
  - [ ] `CLERK_WEBHOOK_SECRET` (del dashboard)
  - [ ] `CLERK_JWKS_URL` (frontend API URL)
  - [ ] `CLERK_ISSUER` (igual que JWKS_URL sin `/.well-known/...`)

### Local Development
```bash
# 1. Copiar .env.example a .env
cp .env.example .env

# 2. Actualizar .env con Clerk credentials
vim .env

# 3. Instalar dependencias
npm install

# 4. Iniciar servidor offline
npm run dev

# Servidor disponible en http://localhost:3000
```

### Deploy a AWS
```bash
# Staging
serverless deploy --stage staging

# Production (después de validar)
serverless deploy --stage prod
```

### Post-deployment
- [ ] Obtener API Gateway endpoint URL
- [ ] Configurar webhook en Clerk Dashboard
  - [ ] URL: `{tu-api-endpoint}/webhooks/clerk`
  - [ ] Signing Secret: copiar a AWS SSM o .env
  - [ ] Seleccionar eventos (ver lista arriba)
- [ ] Testear con webhook test desde Clerk Dashboard
- [ ] Validar que users y organizations se crean automáticamente

---

## 🎯 Frontend Integration (React + Clerk)

### 1. Setup Básico

```typescript
// app.tsx
import { ClerkProvider } from '@clerk/clerk-react';

export default function App() {
  return (
    <ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
      <YourApp />
    </ClerkProvider>
  );
}
```

### 2. Obtener JWT Token

```typescript
import { useAuth } from '@clerk/clerk-react';

function MyComponent() {
  const { getToken } = useAuth();

  const fetchWithAuth = async (url: string, options?: RequestInit) => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...options?.headers,
        'Authorization': `Bearer ${token}`,
      },
    });
  };

  return <div>...</div>;
}
```

### 3. Crear Organización (Onboarding)

```typescript
import { useOrganization, useClerk } from '@clerk/clerk-react';

function CreateOrgStep() {
  const { clerk } = useClerk();
  const { getToken } = useAuth();

  const handleCreateOrg = async (formData: {
    name: string;
    teamSize?: number;
    currency?: string;
  }) => {
    try {
      // 1. Crear en Clerk
      const org = await clerk.createOrganization({
        name: formData.name,
      });

      // 2. Esperar evento webhook (1-2 segundos)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 3. Guardar metadata en nuestro backend
      const token = await getToken();
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/organizations`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            clerkOrgId: org.id,
            name: formData.name,
            teamSize: formData.teamSize,
            currency: formData.currency || 'USD',
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to save organization');
      }

      console.log('Organization created successfully');
      // Redirigir a dashboard
    } catch (error) {
      console.error('Error:', error);
    }
  };

  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      handleCreateOrg({
        name: e.currentTarget.name.value,
        teamSize: parseInt(e.currentTarget.teamSize.value),
        currency: e.currentTarget.currency.value,
      });
    }}>
      <input name="name" placeholder="Organization name" required />
      <input name="teamSize" type="number" placeholder="Team size" />
      <select name="currency" defaultValue="USD">
        <option>USD</option>
        <option>EUR</option>
        <option>MXN</option>
      </select>
      <button type="submit">Create Organization</button>
    </form>
  );
}
```

### 4. Listar Organizaciones del Usuario

```typescript
import { useAuth } from '@clerk/clerk-react';

function MyOrganizations() {
  const { getToken } = useAuth();
  const [orgs, setOrgs] = React.useState([]);

  React.useEffect(() => {
    const fetchOrgs = async () => {
      const token = await getToken();
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/users/me/organizations`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );
      const data = await response.json();
      setOrgs(data.data);
    };

    fetchOrgs();
  }, [getToken]);

  return (
    <div>
      {orgs.map(org => (
        <div key={org.orgId}>
          <h3>{org.name}</h3>
          <p>Role: {org.role}</p>
        </div>
      ))}
    </div>
  );
}
```

---

## ⚙️ Variables de Entorno

### Mínimo requerido para funcionar:

```env
# Clerk
CLERK_WEBHOOK_SECRET=whsec_xxxxx
CLERK_JWKS_URL=https://xxx.clerk.accounts.com/.well-known/jwks.json
CLERK_ISSUER=https://xxx.clerk.accounts.com

# AWS
AWS_REGION=us-east-2

# DynamoDB (opcionales - usan defaults)
TABLE_ORGANIZATIONS_BASE=organizations
TABLE_USERS_BASE=users
TABLE_WEBHOOK_EVENTS_BASE=webhook-events
```

### Obtener del Clerk Dashboard:

1. Ve a **API Keys** 
2. Copia **Frontend API URL** (ej: `https://my-app.clerk.accounts.com`)
3. Ve a **Webhooks**
4. Crea endpoint → Copia **Signing Secret** → Pega en `CLERK_WEBHOOK_SECRET`

---

## 🔧 Next Steps (Fase 2)

### IMPORTANTE: Actualizar módulos existentes

Ahora que tenemos auth, necesitas actualizar `clients`, `credit-notes`, `payments`:

**Cambio requerido**:
```typescript
// Antes
const orgId = event.pathParameters?.orgId || process.env.SEED_ORG_ID;

// Después
const { userId, orgId } = getAuth(event);
if (!orgId) throw new HttpError(403, 'Organization context required');
```

Archivos a actualizar:
- `src/functions/clients/handler.ts` (6 funciones)
- `src/functions/credit-notes/handler.ts` (6 funciones)
- `src/functions/payments/handler.ts` (6 funciones)
- `src/functions/credit-usage/handler.ts` (2 funciones)

Cada handler debe llamar `getAuth(event)` al principio para obtener `userId` y `orgId`.

### Documentation

Actualizar [API_DOCUMENTATION.md](API_DOCUMENTATION.md) con:
- Nuevos endpoints de organizations y users
- Ejemplos de requests/responses
- Flujo de autenticación
- Schema de DynamoDB

### Testing

Crear tests unitarios para:
- Verificación de firma Svix
- Validación de JWT
- Validators Zod
- Repository functions

---

## 🚀 Deployment Commands

### Development Local
```bash
npm install
npm run dev
# Server en http://localhost:3000
```

### Staging
```bash
serverless deploy --stage staging
# Output: API Gateway URL
```

### Production
```bash
# Primero, validar en staging
serverless deploy --stage prod
```

### Remover Stack
```bash
serverless remove --stage dev
```

---

## 🐛 Troubleshooting

### Error: "CLERK_WEBHOOK_SECRET not found"
**Solución**: Verificar que `.env` tiene `CLERK_WEBHOOK_SECRET=whsec_...`

### Error: "Invalid token / JWT expired"
**Solución**: 
- Verificar que `CLERK_ISSUER` y `CLERK_JWKS_URL` sean correctos
- Obtener nuevo token del frontend

### Error: "Webhook signature invalid"
**Solución**:
- Copiar `Signing Secret` completo (incluyendo `whsec_`)
- No incluir espacios adicionales

### Webhook no procesa eventos
**Solución**:
- Verificar URL webhook en Clerk Dashboard (debe ser accesible)
- Revisar logs en Clerk → Webhooks → Activity
- En local: usar `svix listen` para debugging

---

## 📚 Documentación Adicional

Consulta estos archivos:
- [CLERK_SETUP.md](./CLERK_SETUP.md) - Guía paso-a-paso
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md) - Endpoints completosistema
- [.env.example](./.env.example) - Template de variables

---

## ✅ Validación Post-Deploy

1. **Health check**:
   ```bash
   curl http://localhost:3000/hello
   ```

2. **Test JWT Authorizer**:
   ```bash
   # Obtén token del frontend
   curl -H "Authorization: Bearer <token>" http://localhost:3000/users/me
   ```

3. **Test webhook** (en Clerk Dashboard):
   - Ve a Webhooks → Selecciona endpoint → Test Endpoint
   - Verifica que recibas 200 OK
   - Revisa logs: `aws logs tail /aws/lambda/canaima-backend-dev-clerkWebhook`

---

**¡Implementación completada! 🎉**

Commit: `05ad15e`  
Fecha: 2026-05-24  
Status: Listo para desplegar
