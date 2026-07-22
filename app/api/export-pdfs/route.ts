import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

export const runtime = "nodejs";
export const maxDuration = 300;

interface PageData {
  pageNumber: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string>>;
}

interface ExportRequest {
  pages: PageData[];
}

// Columns to show in the PDF, in order. Falls back to whatever columns exist.
const PREFERRED_COLUMNS = [
  "No",
  "Channel",
  "Contact Name",
  "Nomer Telp/User ID",
  "Omni Channel Contact Link",
  "CRM Contact Link",
  "Link Room ID",
  "Tagging Omni Channel"
];

function pickColumns(available: string[]): string[] {
  const preferred = PREFERRED_COLUMNS.filter((c) => available.includes(c));
  return preferred.length > 0 ? preferred : available;
}

function generatePDF(page: PageData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cols = pickColumns(page.columns);

    // Title
    doc.fontSize(16).font("Helvetica-Bold").fillColor("#111").text(page.title, { align: "left" });
    doc.moveDown(0.5);

    // Simple table: header row + data rows.
    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colWidth = usableWidth / cols.length;
    let y = doc.y;

    const rowHeight = 18;
    const drawRow = (values: string[], bold: boolean) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8).fillColor("#111");
      let x = startX;
      for (const v of values) {
        doc.text(String(v ?? "").slice(0, 60), x + 2, y + 4, {
          width: colWidth - 4,
          height: rowHeight,
          ellipsis: true,
          lineBreak: false
        });
        x += colWidth;
      }
      // horizontal rule
      doc.moveTo(startX, y + rowHeight).lineTo(startX + usableWidth, y + rowHeight).strokeColor("#ddd").lineWidth(0.5).stroke();
      y += rowHeight;
    };

    // Header
    drawRow(cols, true);

    // Rows, with page breaks when we run past the bottom margin.
    for (const row of page.rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ margin: 36, size: "A4", layout: "landscape" });
        y = doc.page.margins.top;
        drawRow(cols, true);
      }
      drawRow(cols.map((c) => row[c] ?? ""), false);
    }

    doc.end();
  });
}

export async function POST(req: NextRequest) {
  try {
    const body: ExportRequest = await req.json();
    const { pages } = body;

    if (!Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json({ error: "No pages to export." }, { status: 400 });
    }

    const buffers = await Promise.all(pages.map((p) => generatePDF(p)));

    const zip = new JSZip();
    buffers.forEach((buf, i) => {
      zip.file(`page_${pages[i].pageNumber}.pdf`, buf);
    });

    const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });

    return new Response(zipBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="tableau-export-${Date.now()}.zip"`
      }
    });
  } catch (err: any) {
    console.error("Export error:", err);
    return NextResponse.json({ error: err?.message || "Export failed" }, { status: 500 });
  }
}
