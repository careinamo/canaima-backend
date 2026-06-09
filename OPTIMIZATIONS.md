# Optimizaciones para Bajo Consumo

Este documento contiene recomendaciones de optimización para reducir costos durante la fase inicial del proyecto (12-15 usuarios, ~1 año).

## Resumen de Costos AWS Actuales

Con la configuración actual y bajo tráfico (~15 usuarios), los costos estimados mensuales son:

| Servicio | Costo Estimado | Notas |
|----------|----------------|-------|
| Lambda | ~$0-1 | Free tier: 1M requests/mes |
| DynamoDB | ~$0-5 | PAY_PER_REQUEST + storage |
| API Gateway | ~$0-1 | HTTP API es muy barato |
| EventBridge | ~$0 | Casi gratis para bajo volumen |
| SQS | ~$0 | Free tier: 1M requests |
| CloudWatch Logs | ~$1-3 | Depende de retención |

**Total estimado: $2-10/mes** (sin contar dominio, certificados, etc.)

---

## 1. Optimizaciones Lambda (Recomendadas)

### 1.1 Reducir Memoria (ALTO IMPACTO)

Lambda cobra por GB-segundo. Por defecto usa 1024MB, pero la mayoría de funciones CRUD necesitan mucho menos.

```yaml
# Agregar en provider o por función individual
provider:
  memorySize: 256  # Default para todas las funciones

# O por función específica si alguna necesita más:
functions:
  bulkImportClients:
    memorySize: 512  # Solo esta necesita más memoria
```

**Funciones que pueden usar 256MB:**
- Todos los CRUD handlers (clients, payments, credit-notes, organizations, users)
- clerkAuthorizer
- Webhooks

**Funciones que podrían necesitar 512MB:**
- `bulkImportClients` (procesa lotes grandes)
- `calculateMetrics` (puede procesar muchos registros)
- `calculateCreditUsageScheduled` (cálculos batch)

### 1.2 Reducir Timeouts

Timeouts más bajos ahorran en caso de errores/loops infinitos:

```yaml
provider:
  timeout: 10  # Default de 10s en lugar de 29s

functions:
  # Solo las funciones lentas con timeout mayor
  bulkImportClients:
    timeout: 30
  calculateCreditUsageScheduled:
    timeout: 60
  calculateMetrics:
    timeout: 30
```

### 1.3 ARM64 Architecture (15-20% más barato)

```yaml
provider:
  architecture: arm64  # Graviton2, más barato y a menudo más rápido
```

**Nota:** Asegurarse de que no hay dependencias nativas que solo funcionen en x86_64.

---

## 2. Optimizaciones DynamoDB (Ya Optimizado)

### 2.1 On-Demand Billing ✅ 
Ya estás usando `PAY_PER_REQUEST`, que es ideal para bajo tráfico. No cambies a provisioned capacity hasta tener tráfico predecible y alto.

### 2.2 TTL en Audit Logs ✅
Ya tienes TTL de 90 días configurado. Bien.

### 2.3 Revisar GSIs No Utilizados

Cada GSI duplica el almacenamiento y consume WCU. Revisar si todos se usan:

**PaymentsTable** tiene 4 GSIs:
- `clientIdIndex` - ✅ Probablemente necesario
- `creditNoteIdIndex` - ✅ Necesario para pagos por nota
- `statusIndex` - ⚠️ ¿Se usa para filtrar por status?
- `methodIndex` - ⚠️ ¿Se usa para filtrar por método de pago?

Si `statusIndex` o `methodIndex` no se usan en queries reales, considera eliminarlos.

### 2.4 Projection Type

Si algunos GSIs solo se usan para verificar existencia, cambiar de `ALL` a `KEYS_ONLY`:

```yaml
GlobalSecondaryIndexes:
  - IndexName: emailIndex
    Projection:
      ProjectionType: KEYS_ONLY  # Solo guarda las keys, no todos los atributos
```

---

## 3. Optimizaciones API Gateway (Ya Optimizado)

### 3.1 HTTP API v2 ✅
Ya estás usando HTTP API (`httpApi`) en lugar de REST API. HTTP API es ~70% más barato.

### 3.2 Cacheo en API Gateway (Opcional)

Si hay endpoints que siempre devuelven lo mismo (ej: configuración), podrías agregar caching. Pero con 15 usuarios no vale la pena la complejidad.

---

## 4. Optimizaciones CloudWatch

### 4.1 Reducir Retención de Logs

Por defecto los logs nunca expiran. Configurar retención:

```yaml
resources:
  Resources:
    ListClientsLogGroup:
      Type: AWS::Logs::LogGroup
      Properties:
        LogGroupName: /aws/lambda/${self:service}-${self:provider.stage}-listClients
        RetentionInDays: 14  # Solo 2 semanas
```

**Recomendaciones de retención:**
- Dev: 7-14 días
- Prod: 30-90 días

### 4.2 Log Level en Producción

Reducir cantidad de logs en producción:

```yaml
provider:
  environment:
    LOG_LEVEL: ${self:provider.stage, 'info'}  # debug solo en dev
```

Y en código:
```typescript
if (process.env.LOG_LEVEL === 'debug') {
  console.log('[DEBUG] ...', data);
}
```

---

## 5. Optimizaciones de Código

### 5.1 Conexiones DynamoDB

Reutilizar el cliente de DynamoDB entre invocaciones:

```typescript
// ✅ BIEN - Fuera del handler, se reutiliza
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const handler = async (event) => {
  // Usa `client` aquí
};
```

```typescript
// ❌ MAL - Nuevo cliente en cada invocación
export const handler = async (event) => {
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
};
```

### 5.2 Bundling y Tree Shaking

Ya tienes esbuild configurado con `bundle: true`. Verificar que no se incluyan dependencias innecesarias:

```yaml
build:
  esbuild:
    bundle: true
    minify: true  # Cambiar a true en producción
    sourcemap: false  # Desactivar en producción para reducir tamaño
    external:
      - '@aws-sdk/*'  # Ya incluido en el runtime de Lambda
```

**AWS SDK v3 ya está incluido en Lambda nodejs18.x+**, no necesitas bundlearlo.

### 5.3 Lazy Loading de Dependencias

Si una dependencia solo se usa en ciertos paths, cárgala condicionalmente:

```typescript
// En lugar de:
import { parseUserAgent } from 'big-ua-parser-library';

// Usar:
const getUAParser = async () => import('big-ua-parser-library');
```

---

## 6. Optimizaciones SQS

### 6.1 Batch Size ✅
Ya tienes `batchSize: 10`, que es eficiente.

### 6.2 Visibility Timeout

Asegurarse de que el visibility timeout es >= 6x el timeout de Lambda:

```yaml
ClientDelinquencyCheckQueue:
  Properties:
    VisibilityTimeout: 60  # Si el Lambda tiene timeout de 10s
```

---

## 7. Optimizaciones EventBridge

Con bajo tráfico, EventBridge es prácticamente gratis ($1 por millón de eventos). No hay optimizaciones necesarias.

---

## 8. Configuración Recomendada Final

Agregar esto al `serverless.yml`:

```yaml
provider:
  name: aws
  runtime: nodejs24.x
  architecture: arm64           # 👈 NUEVO: Más barato
  memorySize: 256               # 👈 NUEVO: Default bajo
  timeout: 10                   # 👈 NUEVO: Default bajo
  # ... resto igual

functions:
  # Funciones que necesitan más recursos
  bulkImportClients:
    memorySize: 512
    timeout: 30
    
  calculateCreditUsageScheduled:
    memorySize: 512
    timeout: 60
    
  calculateMetrics:
    memorySize: 512
    timeout: 30
```

---

## 9. Monitoreo de Costos

### 9.1 AWS Cost Explorer

Activar Cost Explorer y configurar alertas:
1. Ir a AWS Billing > Cost Explorer
2. Crear un presupuesto de $20/mes
3. Configurar alertas al 50%, 80%, 100%

### 9.2 CloudWatch Billing Alarm

```yaml
resources:
  Resources:
    BillingAlarm:
      Type: AWS::CloudWatch::Alarm
      Properties:
        AlarmName: ${self:service}-${self:provider.stage}-billing-alarm
        MetricName: EstimatedCharges
        Namespace: AWS/Billing
        Statistic: Maximum
        Period: 21600  # 6 horas
        EvaluationPeriods: 1
        Threshold: 20  # $20
        ComparisonOperator: GreaterThanThreshold
        Dimensions:
          - Name: Currency
            Value: USD
```

---

## 10. Qué NO Hacer (Anti-patterns)

### ❌ No usar Provisioned Concurrency
Con 15 usuarios, cold starts ocasionales son aceptables. Provisioned concurrency cuesta ~$15/mes por función.

### ❌ No usar VPC innecesariamente
Las Lambdas fuera de VPC son más rápidas y baratas. Solo usar VPC si necesitas acceder a recursos privados (RDS, ElastiCache).

### ❌ No usar Step Functions para flujos simples
Step Functions cobra por transición de estado. Para flujos simples, invocar Lambdas directamente.

### ❌ No activar X-Ray tracing sin necesidad
X-Ray cobra por traces. Solo activar cuando necesites debuggear problemas de performance.

---

## Implementación Inmediata

Para aplicar las optimizaciones más importantes ahora:

```yaml
# Agregar al provider en serverless.yml
provider:
  architecture: arm64
  memorySize: 256
  timeout: 10
```

**Impacto estimado:** Reducción de ~30-50% en costos de Lambda (que ya son casi $0).

---

## Checklist de Optimización

### Lambda (Alto Impacto)
- [x] Configurar `memorySize: 256` como default
- [x] Configurar `timeout: 10` como default
- [x] Cambiar a `architecture: arm64` (15-20% más barato)
- [x] Configurar `memorySize: 512` para `bulkImportClients`
- [x] Configurar `memorySize: 512` y `timeout: 60` para `calculateCreditUsageScheduled`
- [x] Configurar `memorySize: 512` y `timeout: 30` para `calculateMetrics`

### DynamoDB
- [ ] Revisar y eliminar GSIs no utilizados (`statusIndex`, `methodIndex`)
- [ ] Cambiar `ProjectionType: ALL` a `KEYS_ONLY` en GSIs que solo verifican existencia

### CloudWatch Logs
- [ ] Configurar retención de logs a 14-30 días
- [ ] Configurar variable `LOG_LEVEL` (debug en dev, info en prod)
- [ ] Reducir console.log innecesarios en producción

### Código y Bundling
- [x] Cambiar `minify: true` para producción
- [x] Cambiar `sourcemap: false` para producción
- [x] Agregar `external: ['@aws-sdk/*']` en esbuild
- [ ] Verificar que DynamoDB client esté fuera del handler (reutilización)
- [ ] Considerar lazy loading para dependencias pesadas opcionales

### SQS
- [ ] Verificar `VisibilityTimeout` >= 6x el timeout de Lambda

### Monitoreo de Costos
- [ ] Activar AWS Cost Explorer
- [ ] Crear presupuesto de $20/mes con alertas al 50%, 80%, 100%
- [ ] Configurar CloudWatch Billing Alarm ($20 threshold)

### API Gateway (Opcional)
- [ ] Considerar caching para endpoints con respuestas estáticas (solo si necesario)

---

## Cuándo Escalar

Señales de que necesitas revisar la configuración:

1. **Latencia alta (>1s P99):** Aumentar memoria
2. **Throttling en DynamoDB:** Considerar provisioned capacity
3. **Cold starts frecuentes:** Considerar provisioned concurrency
4. **Costos >$50/mes:** Revisar CloudWatch Logs y GSIs

Con 15 usuarios, ninguna de estas debería ocurrir durante el primer año.
