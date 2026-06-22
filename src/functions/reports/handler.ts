import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import PDFDocument from 'pdfkit';
import { listAllClients } from './repository';
import type { GenerateClientReportResponse, ClientReportRow } from './types';
import { getCurrentTimestampInTimezone } from '../shared/timezone-utils';

const BUCKET_NAME = process.env.REPORTS_BUCKET as string;
const PRESIGNED_URL_EXPIRATION = 3600; // 1 hour in seconds

const s3Client = new S3Client({});

/**
 * Generate a PDF report with all clients from an organization
 * POST /orgs/{orgId}/reports/clients-debt
 */
export async function generateClientsDebtReport(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const orgId = event.pathParameters?.orgId;

    if (!orgId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Missing orgId parameter' }),
      };
    }

    console.log(`[Reports] Generating clients debt report for org: ${orgId}`);

    // Fetch all clients from the organization
    const clients = await listAllClients(orgId);
    console.log(`[Reports] Found ${clients.length} clients`);

    // Transform to report rows
    const reportRows: ClientReportRow[] = clients.map((client) => ({
      name: client.name,
      document: client.document || 'N/A',
      accumulatedDebt: client.accumulatedDebt,
    }));

    // Calculate totals
    const totalDebt = reportRows.reduce((sum, row) => sum + row.accumulatedDebt, 0);

    // Generate PDF
    const pdfBuffer = await generatePDF(reportRows, orgId, totalDebt);
    console.log(`[Reports] PDF generated, size: ${pdfBuffer.length} bytes`);

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `clients-debt-report-${orgId}-${timestamp}.pdf`;
    const s3Key = `reports/${orgId}/${fileName}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: pdfBuffer,
        ContentType: 'application/pdf',
        Metadata: {
          orgId,
          generatedAt: new Date().toISOString(),
          totalClients: String(clients.length),
        },
      }),
    );
    console.log(`[Reports] PDF uploaded to S3: ${s3Key}`);

    // Generate presigned URL for download
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        ResponseContentDisposition: `attachment; filename="${fileName}"`,
      }),
      { expiresIn: PRESIGNED_URL_EXPIRATION },
    );

    const response: GenerateClientReportResponse = {
      success: true,
      downloadUrl,
      expiresIn: PRESIGNED_URL_EXPIRATION,
      fileName,
      generatedAt: getCurrentTimestampInTimezone(),
      totalClients: clients.length,
      totalDebt,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error('[Reports] Error generating report:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Failed to generate report', details: message }),
    };
  }
}

/**
 * Generate a PDF document with clients debt information
 */
async function generatePDF(
  rows: ClientReportRow[],
  orgId: string,
  totalDebt: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('Reporte de Deuda de Clientes', { align: 'center' });
    doc.moveDown(0.5);

    // Metadata
    doc.fontSize(10).font('Helvetica');
    doc.text(`Organización: ${orgId}`, { align: 'left' });
    doc.text(`Fecha de generación: ${new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' })}`, { align: 'left' });
    doc.text(`Total de clientes: ${rows.length}`, { align: 'left' });
    doc.text(`Deuda total: $${formatNumber(totalDebt)}`, { align: 'left' });
    doc.moveDown(1);

    // Table configuration
    const tableTop = doc.y;
    const tableLeft = 50;
    const colWidths = {
      name: 220,
      document: 150,
      debt: 120,
    };
    const rowHeight = 25;
    const headerHeight = 30;

    // Table header background
    doc.fillColor('#2563EB').rect(tableLeft, tableTop, 490, headerHeight).fill();

    // Table header text
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11);
    doc.text('Cliente', tableLeft + 10, tableTop + 8, { width: colWidths.name });
    doc.text('Documento', tableLeft + colWidths.name + 10, tableTop + 8, { width: colWidths.document });
    doc.text('Deuda Acumulada', tableLeft + colWidths.name + colWidths.document + 10, tableTop + 8, { width: colWidths.debt });

    // Reset for data rows
    doc.fillColor('#000000').font('Helvetica').fontSize(10);

    let y = tableTop + headerHeight;
    let rowIndex = 0;

    for (const row of rows) {
      // Check if we need a new page
      if (y + rowHeight > 700) {
        doc.addPage();
        y = 50;

        // Re-draw header on new page
        doc.fillColor('#2563EB').rect(tableLeft, y, 490, headerHeight).fill();
        doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(11);
        doc.text('Cliente', tableLeft + 10, y + 8, { width: colWidths.name });
        doc.text('Documento', tableLeft + colWidths.name + 10, y + 8, { width: colWidths.document });
        doc.text('Deuda Acumulada', tableLeft + colWidths.name + colWidths.document + 10, y + 8, { width: colWidths.debt });

        doc.fillColor('#000000').font('Helvetica').fontSize(10);
        y += headerHeight;
        rowIndex = 0;
      }

      // Alternate row background
      if (rowIndex % 2 === 0) {
        doc.fillColor('#F3F4F6').rect(tableLeft, y, 490, rowHeight).fill();
      } else {
        doc.fillColor('#FFFFFF').rect(tableLeft, y, 490, rowHeight).fill();
      }

      // Row borders
      doc.strokeColor('#E5E7EB').lineWidth(0.5);
      doc.rect(tableLeft, y, 490, rowHeight).stroke();

      // Row data
      doc.fillColor('#000000');
      const textY = y + 7;

      // Truncate long names
      const displayName = row.name.length > 35 ? row.name.substring(0, 35) + '...' : row.name;
      doc.text(displayName, tableLeft + 10, textY, { width: colWidths.name - 20 });
      doc.text(row.document, tableLeft + colWidths.name + 10, textY, { width: colWidths.document - 20 });
      doc.text(`$${formatNumber(row.accumulatedDebt)}`, tableLeft + colWidths.name + colWidths.document + 10, textY, {
        width: colWidths.debt - 20,
        align: 'right',
      });

      y += rowHeight;
      rowIndex++;
    }

    // Footer with totals
    doc.moveDown(2);
    doc.font('Helvetica-Bold').fontSize(12);
    doc.text(`Total Deuda: $${formatNumber(totalDebt)}`, { align: 'right' });

    // Page numbers
    const pageCount = doc.bufferedPageRange();
    for (let i = 0; i < pageCount.count; i++) {
      doc.switchToPage(i);
      doc.fontSize(8).font('Helvetica').fillColor('#6B7280');
      doc.text(`Página ${i + 1} de ${pageCount.count}`, 50, 750, { align: 'center', width: 490 });
    }

    doc.end();
  });
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
