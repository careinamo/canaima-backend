# Frontend: Botón de Reporte de Saldos de Clientes

## Descripción

Implementar un botón en la sección de Reportes que permita generar y descargar un PDF con todos los saldos (deudas) de los clientes de la organización.

---

## Ubicación

- **Pantalla:** Reportes
- **Posición:** Parte superior de la pantalla
- **Texto del botón:** "Todos los Saldos" (o "Exportar Saldos")

---

## Diseño del Botón

```tsx
<Button
  variant="primary"
  icon={<FileText />}  // o <Download />
  onClick={handleGenerateReport}
  loading={isGenerating}
>
  Todos los Saldos
</Button>
```

---

## Endpoint del Backend

```
POST /orgs/{orgId}/reports/clients-debt
```

**Headers:**
- `Authorization: Bearer {token}` (token de Clerk)

**Response:**
```json
{
  "success": true,
  "downloadUrl": "https://...",
  "expiresIn": 3600,
  "fileName": "clients-debt-report-org_xxx-2026-06-22.pdf",
  "generatedAt": "2026-06-22T14:30:00.000Z",
  "totalClients": 207,
  "totalDebt": 500000.00
}
```

---

## Implementación

```tsx
import { useState } from 'react';
import { useAuth } from '@clerk/clerk-react';
import { toast } from 'sonner'; // o tu librería de notificaciones

const ReportsPage = () => {
  const [isGenerating, setIsGenerating] = useState(false);
  const { getToken } = useAuth();
  const orgId = /* obtener orgId del contexto */;

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    
    try {
      const token = await getToken();
      
      const response = await fetch(
        `${API_BASE_URL}/orgs/${orgId}/reports/clients-debt`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Error al generar el reporte');
      }

      const data = await response.json();

      // Abrir URL de descarga en nueva pestaña
      window.open(data.downloadUrl, '_blank');

      // O descargar directamente:
      // const link = document.createElement('a');
      // link.href = data.downloadUrl;
      // link.download = data.fileName;
      // link.click();

      toast.success(`Reporte generado: ${data.totalClients} clientes`);

    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Error al generar el reporte');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Reportes</h1>
        
        <Button
          onClick={handleGenerateReport}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Spinner className="mr-2" />
              Generando...
            </>
          ) : (
            <>
              <FileText className="mr-2 h-4 w-4" />
              Todos los Saldos
            </>
          )}
        </Button>
      </div>

      {/* Resto del contenido de reportes */}
    </div>
  );
};
```

---

## Flujo de Usuario

1. Usuario hace clic en botón **"Todos los Saldos"**
2. Botón muestra estado de loading (spinner + "Generando...")
3. Se hace llamada POST al backend
4. Backend genera PDF y lo sube a S3
5. Backend devuelve URL presignada
6. Frontend abre la URL en nueva pestaña → se descarga el PDF
7. Toast de éxito: "Reporte generado: X clientes"

---

## Contenido del PDF Generado

| Cliente | Documento | Deuda Acumulada |
|---------|-----------|-----------------|
| ACME Corp | J123456789 | $5,000.00 |
| Tech Solutions | V20345537 | $3,200.50 |
| ... | ... | ... |

**Incluye:**
- Encabezado con organización y fecha
- Tabla ordenada alfabéticamente
- Total de deuda al final
- Paginación automática

---

## Notas Técnicas

- La URL presignada expira en **1 hora**
- El PDF se elimina automáticamente de S3 después de **7 días**
- Timeout del endpoint: **60 segundos** (para organizaciones con muchos clientes)
