import { NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/http';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { aggregateCashFlow, aggregateSpending, aggregateIncome } from '@/lib/reports';
import type { ReportRow } from '@/lib/reports';

/**
 * POST /api/reports/export/pdf
 * Body: { rows: ReportRow[], title?: string }
 * Returns a PDF Blob as base64 data URL.
 */
export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  const body = await request.json();
  const rows: ReportRow[] = body.rows || [];
  const title = body.title || 'Financial Report';

  try {
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage();
    const { width, height } = page.getSize();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const normalFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Header
    page.drawText(title, { x: 50, y: height - 50, size: 24, font, color: rgb(0, 0, 0) });
    // Summary
    const cash = aggregateCashFlow(rows);
    const spend = aggregateSpending(rows);
    const income = aggregateIncome(rows);
    const summary = `Cash Flow: $${(cash.total / 100).toFixed(2)}  Income: $${(income.total / 100).toFixed(2)}  Spending: $${(spend.total / 100).toFixed(2)}`;
    page.drawText(summary, { x: 50, y: height - 80, size: 12, font: normalFont, color: rgb(0.2, 0.2, 0.2) });

    // Table header
    const startY = height - 110;
    let y = startY;
    const colX = [50, 200, 350, 470];
    const cols = ['Date', 'Category', 'Amount', 'Type'];
    cols.forEach((text, i) => {
      page.drawText(text, { x: colX[i], y, size: 10, font: normalFont, color: rgb(0, 0, 0) });
    });
    y -= 15;
    // Table rows (max 40 rows to keep PDF small)
    for (let i = 0; i < Math.min(rows.length, 40); i++) {
      const r = rows[i];
      page.drawText(r.date, { x: colX[0], y, size: 9, font: normalFont, color: rgb(0, 0, 0) });
      page.drawText(r.category, { x: colX[1], y, size: 9, font: normalFont, color: rgb(0, 0, 0) });
      const amt = `$${(r.amount / 100).toFixed(2)}`;
      page.drawText(amt, { x: colX[2], y, size: 9, font: normalFont, color: rgb(0, 0, 0) });
      page.drawText(r.type, { x: colX[3], y, size: 9, font: normalFont, color: rgb(0, 0, 0) });
      y -= 12;
    }

    const pdfBytes = await pdfDoc.save();
    const base64 = Buffer.from(pdfBytes).toString('base64');
    return NextResponse.json({ dataUrl: `data:application/pdf;base64,${base64}` });
  } catch (e) {
    return errorResponse('reports.pdf', e);
  }
}

