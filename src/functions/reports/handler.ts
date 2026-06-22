import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
    const pdfBytes = await generatePDF(reportRows, orgId, totalDebt);
    console.log(`[Reports] PDF generated, size: ${pdfBytes.length} bytes`);

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `clients-debt-report-${orgId}-${timestamp}.pdf`;
    const s3Key = `reports/${orgId}/${fileName}`;

    // Upload to S3
    await s3Client.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: pdfBytes,
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
 * Generate a PDF document with clients debt information using pdf-lib
 */
async function generatePDF(
  rows: ClientReportRow[],
  orgId: string,
  totalDebt: number,
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Page dimensions (Letter size)
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 50;
  const tableWidth = pageWidth - 2 * margin;

  // Column widths
  const colWidths = {
    name: tableWidth * 0.45,
    document: tableWidth * 0.30,
    debt: tableWidth * 0.25,
  };

  const rowHeight = 22;
  const headerHeight = 28;
  const rowsPerPage = Math.floor((pageHeight - 200) / rowHeight); // Leave room for header and footer

  // Colors
  const headerBgColor = rgb(0.145, 0.388, 0.922); // #2563EB
  const headerTextColor = rgb(1, 1, 1);
  const textColor = rgb(0, 0, 0);
  const alternateRowColor = rgb(0.953, 0.957, 0.965); // #F3F4F6
  const borderColor = rgb(0.898, 0.906, 0.922); // #E5E7EB
  const grayTextColor = rgb(0.42, 0.45, 0.49); // #6B7280

  // Format date for Venezuela timezone
  const generatedDate = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

  // Calculate total pages needed
  const totalPages = Math.ceil(rows.length / rowsPerPage);

  for (let pageNum = 0; pageNum < totalPages; pageNum++) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    // Header (only on first page)
    if (pageNum === 0) {
      // Title
      page.drawText('Reporte de Deuda de Clientes', {
        x: margin,
        y,
        size: 18,
        font: helveticaBold,
        color: textColor,
      });
      y -= 30;

      // Metadata
      const metaLines = [
        `Organizacion: ${orgId}`,
        `Fecha de generacion: ${generatedDate}`,
        `Total de clientes: ${rows.length}`,
        `Deuda total: $${formatNumber(totalDebt)}`,
      ];

      for (const line of metaLines) {
        page.drawText(line, {
          x: margin,
          y,
          size: 10,
          font: helvetica,
          color: textColor,
        });
        y -= 15;
      }
      y -= 15;
    } else {
      y -= 20; // Small top margin for continuation pages
    }

    // Table header background
    page.drawRectangle({
      x: margin,
      y: y - headerHeight,
      width: tableWidth,
      height: headerHeight,
      color: headerBgColor,
    });

    // Table header text
    const headerY = y - 18;
    page.drawText('Cliente', {
      x: margin + 8,
      y: headerY,
      size: 10,
      font: helveticaBold,
      color: headerTextColor,
    });
    page.drawText('Documento', {
      x: margin + colWidths.name + 8,
      y: headerY,
      size: 10,
      font: helveticaBold,
      color: headerTextColor,
    });
    page.drawText('Deuda Acumulada', {
      x: margin + colWidths.name + colWidths.document + 8,
      y: headerY,
      size: 10,
      font: helveticaBold,
      color: headerTextColor,
    });

    y -= headerHeight;

    // Calculate rows for this page
    const startRow = pageNum * rowsPerPage;
    const endRow = Math.min(startRow + rowsPerPage, rows.length);
    const pageRows = rows.slice(startRow, endRow);

    // Draw rows
    for (let i = 0; i < pageRows.length; i++) {
      const row = pageRows[i];
      const rowY = y - rowHeight;

      // Alternate row background
      if (i % 2 === 0) {
        page.drawRectangle({
          x: margin,
          y: rowY,
          width: tableWidth,
          height: rowHeight,
          color: alternateRowColor,
        });
      }

      // Row border
      page.drawRectangle({
        x: margin,
        y: rowY,
        width: tableWidth,
        height: rowHeight,
        borderColor: borderColor,
        borderWidth: 0.5,
      });

      // Row data
      const textY = rowY + 6;

      // Truncate long names
      const displayName = row.name.length > 30 ? row.name.substring(0, 30) + '...' : row.name;
      page.drawText(displayName, {
        x: margin + 8,
        y: textY,
        size: 9,
        font: helvetica,
        color: textColor,
      });

      page.drawText(row.document, {
        x: margin + colWidths.name + 8,
        y: textY,
        size: 9,
        font: helvetica,
        color: textColor,
      });

      const debtText = `$${formatNumber(row.accumulatedDebt)}`;
      const debtWidth = helvetica.widthOfTextAtSize(debtText, 9);
      page.drawText(debtText, {
        x: margin + colWidths.name + colWidths.document + colWidths.debt - debtWidth - 8,
        y: textY,
        size: 9,
        font: helvetica,
        color: textColor,
      });

      y -= rowHeight;
    }

    // Footer - Total on last page
    if (pageNum === totalPages - 1) {
      y -= 20;
      const totalText = `Total Deuda: $${formatNumber(totalDebt)}`;
      const totalWidth = helveticaBold.widthOfTextAtSize(totalText, 12);
      page.drawText(totalText, {
        x: pageWidth - margin - totalWidth,
        y,
        size: 12,
        font: helveticaBold,
        color: textColor,
      });
    }

    // Page number
    const pageText = `Pagina ${pageNum + 1} de ${totalPages}`;
    const pageTextWidth = helvetica.widthOfTextAtSize(pageText, 8);
    page.drawText(pageText, {
      x: (pageWidth - pageTextWidth) / 2,
      y: 30,
      size: 8,
      font: helvetica,
      color: grayTextColor,
    });
  }

  return pdfDoc.save();
}

/**
 * Format number with thousand separators
 */
function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
