# Postman Collection - Canaima Backend API

## Descripción

Esta es una colección de Postman con todos los endpoints de la API de Canaima Backend, incluyendo:

- **5 Endpoints de Clients** - Gestión de clientes
- **5 Endpoints de Credit Notes** - Gestión de notas de crédito
- **Variables predefinidas** - Para facilitar el testing

## Cómo Importar

### Opción 1: Importar desde archivo

1. Abre **Postman**
2. Haz clic en **Import** (arriba a la izquierda)
3. Selecciona **Upload Files** o **Link**
4. Si es **Upload Files**: selecciona `Canaima.postman_collection.json`
5. Si es **Link**: copia/pega el path al archivo
6. Haz clic en **Import**

### Opción 2: Arrastar y soltar

1. Abre Postman
2. Arrastra `Canaima.postman_collection.json` directamente a la ventana de Postman
3. Haz clic en **Import**

## Variables Predefinidas

La colección incluye las siguientes variables que puedes personalizar:

| Variable | Valor por defecto | Descripción |
|----------|-------------------|-------------|
| `baseUrl` | `http://localhost:3000` | URL base de la API |
| `orgId` | `org-default` | ID de la organización |
| `clientId` | `550e8400-e29b-41d4-a716-446655440001` | UUID de cliente (datos de seed) |
| `creditNoteId` | `660e8400-e29b-41d4-a716-446655550001` | UUID de nota de crédito (datos de seed) |

### Cambiar Variables

Para cambiar las variables:

1. Haz clic en el ícono de **Environment** (variables)
2. Selecciona **Edit** en la colección o ambiente
3. Modifica los valores según sea necesario

## Endpoints Incluidos

### Clients

- `GET /orgs/{orgId}/clients` - Listar clientes
- `GET /orgs/{orgId}/clients/{id}` - Obtener cliente
- `POST /orgs/{orgId}/clients` - Crear cliente
- `PUT /orgs/{orgId}/clients/{id}` - Actualizar cliente
- `DELETE /orgs/{orgId}/clients/{id}` - Eliminar cliente

### Credit Notes

- `GET /orgs/{orgId}/credit-notes` - Listar notas de crédito
- `GET /orgs/{orgId}/credit-notes/{id}` - Obtener nota de crédito
- `POST /orgs/{orgId}/credit-notes` - Crear nota de crédito
- `PUT /orgs/{orgId}/credit-notes/{id}` - Actualizar nota de crédito
- `DELETE /orgs/{orgId}/credit-notes/{id}` - Eliminar nota de crédito

## Pasos para Usar

### 1. Inicia el servidor local

```bash
npm run dev
```

El API estará disponible en `http://localhost:3000`

### 2. Ejecuta el seed (opcional, pero recomendado)

```bash
npm run seed
```

Esto populará la base de datos con datos de ejemplo para ambos módulos.

### 3. Abre Postman

- Importa la colección `Canaima.postman_collection.json`
- Las variables ya están configuradas con valores por defecto

### 4. Comienza a hacer requests

- Selecciona un endpoint de la colección
- Haz clic en **Send** para ejecutar
- Revisa la respuesta en el panel inferior

## Ejemplos de Uso

### Listar clientes

```
GET http://localhost:3000/orgs/org-default/clients?page=1&limit=20
```

### Listar notas de crédito

```
GET http://localhost:3000/orgs/org-default/credit-notes?page=1&limit=20&status=pending
```

### Crear un nuevo cliente

```
POST http://localhost:3000/orgs/org-default/clients

Body:
{
  "name": "Test Client",
  "email": "test@client.com",
  "status": "active",
  "creditLimit": 50000
}
```

### Crear una nota de crédito

```
POST http://localhost:3000/orgs/org-default/credit-notes

Body:
{
  "clientId": "550e8400-e29b-41d4-a716-446655440001",
  "clientName": "Acme Corporation",
  "invoiceNumber": "INV-2024-001",
  "amount": 5000,
  "dueDate": "2025-06-12T00:00:00Z",
  "description": "Credit for returned goods"
}
```

## Notas

- Todos los endpoints retornan JSON
- Los errores incluyen un campo `error` con la descripción del problema
- Las respuestas paginadas incluyen metadata en `pagination`
- Para desarrollo local, asegúrate de que el servidor esté corriendo en `http://localhost:3000`
- Los IDs de cliente y nota de crédito en la colección corresponden a los datos sembrados

## Más Información

Ver [API_DOCUMENTATION.md](API_DOCUMENTATION.md) para documentación completa de cada endpoint.
