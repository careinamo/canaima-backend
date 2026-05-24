# Clerk Integration Setup Guide

Este documento describe cómo completar la implementación de Clerk con los nuevos módulos de organizations y users.

## 1. Instalación de dependencias

```bash
npm install
```

Las siguientes dependencias se agregaron a `package.json`:
- `svix` (v1.15.0) - Para verificar firmas de webhooks de Clerk
- `jose` (v5.4.1) - Para validar y verificar JWTs
- `zod` (v3.22.4) - Para validación de schemas
- `uuid` (v9.0.1) - Para generar IDs únicos

## 2. Configuración de Variables de Entorno

### En tu `.env` local (para desarrollo):

```env
AWS_REGION=us-east-2
CLERK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx  # Obtener del dashboard de Clerk
CLERK_JWKS_URL=https://your-clerk-domain/.well-known/jwks.json
CLERK_ISSUER=https://your-clerk-domain
```

Cómo obtener estos valores:

1. **CLERK_WEBHOOK_SECRET**:
   - Ve a Clerk Dashboard → Webhooks
   - Crea un nuevo webhook endpoint
   - Copia el "Signing Secret" 

2. **CLERK_JWKS_URL** y **CLERK_ISSUER**:
   - Ve a Clerk Dashboard → API Keys
   - Copia tu "Frontend API URL" (ej: `https://my-app.clerk.accounts.com`)
   - CLERK_JWKS_URL: `https://my-app.clerk.accounts.com/.well-known/jwks.json`
   - CLERK_ISSUER: `https://my-app.clerk.accounts.com`

3. **ORG_IDS** (para scheduled credit-usage calculation):
   - Lista de IDs de organizaciones a procesar
   - Ej: `ORG_IDS=org-default,org-partner1`

### En AWS SSM Parameter Store (para producción):

Antes de deployar a producción, crea los parámetros en AWS SSM:

```bash
aws ssm put-parameter --name /canaima/prod/CLERK_WEBHOOK_SECRET --value "whsec_..." --type SecureString
aws ssm put-parameter --name /canaima/prod/CLERK_JWKS_URL --value "https://..." --type String
aws ssm put-parameter --name /canaima/prod/CLERK_ISSUER --value "https://..." --type String
```

## 3. Configurar el Webhook de Clerk

En Clerk Dashboard (Webhooks section):

1. Crea un nuevo webhook
2. **Endpoint URL**: `https://{tu-api-gateway-url}/webhooks/clerk`
   - En local con serverless-offline: `http://localhost:3000/webhooks/clerk`
3. **Eventos a suscribirse**:
   - ✅ user.created
   - ✅ user.updated
   - ✅ user.deleted
   - ✅ organization.created
   - ✅ organization.updated
   - ✅ organization.deleted
   - ✅ organizationMembership.created
   - ✅ organizationMembership.updated
   - ✅ organizationMembership.deleted

4. Guarda y copia el **Signing Secret** a tu `.env` como `CLERK_WEBHOOK_SECRET`

## 4. Deploy

### Desarrollo (local):

```bash
# Instalar dependencias
npm install

# Ejecutar servidor offline
npm run dev
```

El servidor estará disponible en `http://localhost:3000`

### Staging:

```bash
serverless deploy --stage staging
```

### Producción:

```bash
# Primero, asegúrate que las variables estén en SSM
serverless deploy --stage prod
```

## 5. Flujo de Registro de Usuario

### Backend:

1. **Usuario hace SignUp en Clerk** (frontend)
2. **Clerk dispara webhook `user.created`**
   - El webhook crea un registro en `users` table
3. **Usuario completa onboarding y crea organización**
   - Frontend llama `clerk.createOrganization({ name, ... })`
4. **Clerk dispara webhooks**:
   - `organization.created`
   - `organizationMembership.created` (el usuario es miembro/admin)
   - Backend sincroniza con `organizations` table
5. **Frontend llama `POST /organizations`** con detalles adicionales:
   - teamSize, currency, settings
   - Backend guarda metadata completa

### Frontend (React + Clerk):

```typescript
import { useAuth, useOrganization } from '@clerk/clerk-react';

async function createOrgOnboarding() {
  const { getToken } = useAuth();
  const token = await getToken();
  
  // 1. Crear organización en Clerk
  const org = await clerk.createOrganization({
    name: 'My Company',
  });
  
  // 2. Obtener el ID de la organización
  const clerkOrgId = org.id;
  
  // 3. Llamar nuestro backend para guardar metadata
  const response = await fetch(`${API_URL}/organizations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      clerkOrgId,
      name: 'My Company',
      teamSize: 10,
      currency: 'USD',
    }),
  });
  
  const result = await response.json();
  console.log('Organization created:', result.data);
}
```

## 6. Protección de Endpoints

Todos los endpoints excepto `/webhooks/clerk` y `/hello` requieren JWT válido de Clerk.

**Headers requeridos**:
```
Authorization: Bearer <jwt-token>
```

El JWT es validado por el Lambda Authorizer (`clerkAuthorizer`) que:
1. Descarga JWKS de Clerk
2. Valida la firma
3. Extrae claims: `sub` (userId), `org_id`, `org_role`, `org_slug`
4. Inyecta en `requestContext.authorizer.lambda`

## 7. Ejemplos de Requests

### Crear organización (después de Clerk `createOrganization`):

```bash
curl -X POST http://localhost:3000/organizations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "clerkOrgId": "org_xxx",
    "name": "Mi Empresa",
    "teamSize": 5,
    "currency": "USD"
  }'
```

### Listar mis organizaciones:

```bash
curl -X GET http://localhost:3000/users/me/organizations \
  -H "Authorization: Bearer <token>"
```

### Obtener perfil del usuario:

```bash
curl -X GET http://localhost:3000/users/me \
  -H "Authorization: Bearer <token>"
```

### Listar miembros de una organización:

```bash
curl -X GET "http://localhost:3000/organizations/org_xxx/members" \
  -H "Authorization: Bearer <token>"
```

## 8. Estructura de DynamoDB

### Tabla: organizations-{stage}

**PK: ORG#{clerkOrgId}** | **SK**             | Contenido
---|---|---
ORG#org_xxx | META            | Metadata de la org
ORG#org_xxx | USER#user_yyy   | Miembro de la org
ORG#org_xxx | USER#user_zzz   | Miembro de la org

**GSI1**: USER#{userId} → Permite listar todas las orgs de un usuario

### Tabla: users-{stage}

**PK: USER#{clerkUserId}** | **SK**    | Contenido
---|---|---
USER#user_xxx | PROFILE | Perfil del usuario

### Tabla: webhook-events-{stage}

Guarda IDs de eventos de Clerk procesados (TTL 24h)

PK: WEBHOOK#CLERK | SK: {eventId} | Detalles del evento

## 9. Testing

### Test local de webhooks:

```bash
# 1. Instalar herramienta Svix
npm install -g svix

# 2. Crear endpoint Svix local
svix listen http://localhost:3000/webhooks/clerk

# 3. Enviar test desde Clerk Dashboard → Webhooks → Test Endpoint
```

### Test de JWT:

```bash
# Obtén un token de tu frontend React/Clerk
# Luego prueba un endpoint:

curl -X GET http://localhost:3000/users/me \
  -H "Authorization: Bearer <tu-token>"
```

## 10. Troubleshooting

### "Unauthorized: Missing user context"
- JWT no está siendo enviado correctamente
- Verifica que el token tenga formato `Bearer <token>`
- Verifica que CLERK_ISSUER y CLERK_JWKS_URL sean correctos

### "Webhook signature invalid"
- El CLERK_WEBHOOK_SECRET es incorrecto
- Verifica en Clerk Dashboard → Webhooks que copias el "Signing Secret" correcto

### "Organization not found"
- El webhook aún no ha procesado el evento
- Espera unos segundos para que el webhook de Clerk complete
- Verifica en Clerk Dashboard → Activity que el webhook fue enviado

### DynamoDB Tabla no existe
- Verifica que variables de entorno estén correctas
- Ejecuta `serverless deploy` para crear las tablas
- Verifica en AWS Console → DynamoDB que existan

## 11. Próximos Pasos

### Ya implementado ✅
- Módulo organizations
- Módulo users
- Webhooks de Clerk
- JWT Authorizer
- Tablas DynamoDB

### TODO (Next Phase)
- Actualizar módulos existentes (clients, payments, credit-notes) para usar `orgId` del authorizer
- Crear seeds para desarrollo local
- Tests unitarios (Vitest/Jest)
- Documentación de API completa en API_DOCUMENTATION.md
- Rate limiting / throttling
- Audit logging
- Invitaciones por email en organizaciones

## 12. Soporte

Para más detalles, consulta:
- Clerk Docs: https://clerk.com/docs
- Svix Docs: https://docs.svix.com
- JOSE Docs: https://github.com/panva/jose
