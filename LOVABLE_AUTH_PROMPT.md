# URGENTE: Las llamadas al API están fallando con 401 Unauthorized

Las requests NO están enviando el token JWT de Clerk. El backend requiere el header `Authorization` en TODAS las llamadas a la API (excepto `/hello` y `/webhooks/clerk`).

## PROBLEMA ACTUAL

Las requests se están enviando SIN el header Authorization:

```bash
curl 'https://api-dev.canaimacredito.com/orgs/{orgId}/clients' 
  # ❌ NO tiene header Authorization - devuelve 401
```

## SOLUCIÓN REQUERIDA

Cada request debe incluir el token:

```bash
curl 'https://api-dev.canaimacredito.com/orgs/{orgId}/clients'
  -H 'Authorization: Bearer <token>'  # ✅ Token requerido
```

## IMPLEMENTACIÓN

### 1. Obtener el token de Clerk ANTES de cada request

```typescript
import { useAuth } from '@clerk/clerk-react';

const { getToken } = useAuth();
const token = await getToken();
```

### 2. Incluir el token en TODAS las llamadas

```typescript
const response = await fetch(url, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,  // ← ESTO ES OBLIGATORIO
  },
});
```

### 3. Crear un wrapper para fetch (RECOMENDADO)

```typescript
import { useAuth } from '@clerk/clerk-react';

export function useAuthFetch() {
  const { getToken } = useAuth();

  const authFetch = async (url: string, options: RequestInit = {}) => {
    const token = await getToken();
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
    });
  };

  return { authFetch };
}
```

### 4. Si usan axios o cliente HTTP centralizado, agregar interceptor

```typescript
api.interceptors.request.use(async (config) => {
  const token = await getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});
```

## Endpoints que NO requieren token

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/hello` | GET | Health check |
| `/webhooks/clerk` | POST | Webhook de Clerk |
| `/users/{userId}` | GET | Perfil público de usuario |

## Endpoints que SÍ requieren token (TODOS los demás)

| Ruta | Descripción |
|------|-------------|
| `/organizations/*` | Todos los endpoints de organizaciones |
| `/organizations/{orgId}/complete-onboarding` | Completar onboarding |
| `/users/me` | Perfil del usuario actual (GET y PATCH) |
| `/users/me/organizations` | Listar organizaciones del usuario |
| `/orgs/{orgId}/clients/*` | Todos los endpoints de clientes |
| `/orgs/{orgId}/credit-notes/*` | Todos los endpoints de notas de crédito |
| `/orgs/{orgId}/payments/*` | Todos los endpoints de pagos |

## Base URL

```
https://api-dev.canaimacredito.com
```

**Sin el header `Authorization: Bearer <token>`, TODOS los endpoints protegidos devuelven 401 Unauthorized.**
