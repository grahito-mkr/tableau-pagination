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

/**
 * Column order for the PDF using CLEAN display labels. Each entry lists the
 * possible source names (summary data wraps calcs, e.g. "AGG(No)"); the first
 * that exists is used. `group: true` means the cell is blanked when it repeats
 * the row above — mimicking the dashboard's merged No / Channel cells.
 */
const COLUMN_SPEC: Array<{ label: string; sources: string[]; group?: boolean; width: number }> = [
  { label: "No", sources: ["No", "AGG(No)", "SUM(No)", "ATTR(No)"], group: true, width: 0.045 },
  { label: "Channel", sources: ["Channel"], group: true, width: 0.09 },
  { label: "Contact Name", sources: ["Contact Name"], width: 0.13 },
  { label: "Nomer Telp/User ID", sources: ["Nomer Telp/User ID"], width: 0.12 },
  { label: "Omni Channel Contact Link", sources: ["Omni Channel Contact Link"], width: 0.19 },
  { label: "CRM Contact Link", sources: ["CRM Contact Link"], width: 0.115 },
  { label: "Link Room ID", sources: ["Link Room ID"], width: 0.19 },
  { label: "Tagging Omni Channel", sources: ["Tagging Omni Channel"], width: 0.12 }
];

interface ResolvedCol {
  label: string;
  source: string;
  group: boolean;
  width: number;
}

function resolveColumns(available: string[]): ResolvedCol[] {
  const resolved: ResolvedCol[] = [];
  for (const spec of COLUMN_SPEC) {
    const source = spec.sources.find((s) => available.includes(s));
    if (source) {
      resolved.push({ label: spec.label, source, group: Boolean(spec.group), width: spec.width });
    }
  }
  if (resolved.length === 0) {
    return available.map((a) => ({ label: a, source: a, group: false, width: 1 / available.length }));
  }
  return resolved;
}

function generatePDF(page: PageData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 30, size: "A4", layout: "landscape" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cols = resolveColumns(page.columns);

    doc.fontSize(15).font("Helvetica-Bold").fillColor("#111").text(page.title);
    doc.moveDown(0.4);

    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

    const totalW = cols.reduce((s, c) => s + c.width, 0);
    const colX: number[] = [];
    const colW: number[] = [];
    let acc = startX;
    for (const c of cols) {
      const w = (c.width / totalW) * usableWidth;
      colX.push(acc);
      colW.push(w);
      acc += w;
    }

    const headerHeight = 20;
    const rowHeight = 16;
    let y = doc.y;

    const drawHeader = () => {
      doc.rect(startX, y, usableWidth, headerHeight).fill("#f0f0f0");
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#111");
      cols.forEach((c, i) => {
        doc.text(c.label, colX[i] + 3, y + 6, { width: colW[i] - 6, height: headerHeight, ellipsis: true, lineBreak: false });
      });
      doc.moveTo(startX, y + headerHeight).lineTo(startX + usableWidth, y + headerHeight).lineWidth(0.7).strokeColor("#999").stroke();
      y += headerHeight;
    };

    drawHeader();

    // The "No" source identifies lead-group boundaries.
    const noCol = cols.find((c) => c.label === "No");
    let prevRow: Record<string, string> | null = null;
    let prevNo: string | null = null;

    for (let r = 0; r < page.rows.length; r++) {
      const row = page.rows[r];

      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
        y = doc.page.margins.top;
        drawHeader();
        prevRow = null; // re-show grouped values at top of a continued page
        prevNo = null;
      }

      const curNo = noCol ? row[noCol.source] ?? "" : String(r);
      const isNewGroup = curNo !== prevNo;

      // Separator line between lead groups.
      if (isNewGroup && r > 0 && y > doc.page.margins.top + headerHeight) {
        doc.moveTo(startX, y).lineTo(startX + usableWidth, y).lineWidth(0.5).strokeColor("#ccc").stroke();
      }

      doc.font("Helvetica").fontSize(8).fillColor("#111");
      cols.forEach((c, i) => {
        let value = row[c.source] ?? "";

        // Blank grouped columns (No, Channel) when they repeat the value in the
        // row directly above AND we're still inside the same lead group. A new
        // lead group always re-shows both No and Channel. This mirrors the
        // dashboard's merged cells.
        if (c.group && prevRow && !isNewGroup) {
          const prevVal = prevRow[c.source] ?? "";
          if (value === prevVal) value = "";
        }

        doc.text(String(value).slice(0, 90), colX[i] + 3, y + 3, {
          width: colW[i] - 6,
          height: rowHeight,
          ellipsis: true,
          lineBreak: false
        });
      });

      prevRow = row;
      prevNo = curNo;
      y += rowHeight;
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
