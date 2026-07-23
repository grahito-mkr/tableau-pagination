import { NextRequest, NextResponse } from "next/server";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

export const runtime = "nodejs";
export const maxDuration = 300;

interface SignatureEntry {
  title: string;
  role: string;
  name: string;
}

interface PageData {
  pageNumber: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  signature?: SignatureEntry[];
}

interface ExportRequest {
  pages: PageData[];
}

interface ResolvedCol {
  label: string;
  source: string;
  group: boolean;
  width: number;
}

/** Strip a Tableau aggregation wrapper, e.g. "AGG(Employee ID)" -> "Employee ID". */
function cleanLabel(source: string): string {
  const m = source.match(/^[A-Za-z]+\(([^)]+)\)\s*$/);
  return (m ? m[1] : source).trim();
}

/**
 * Preferred column order/labels for the Salary report. Listed in the order
 * they should appear in the PDF. `match` lists the possible cleaned inner
 * names (case-insensitive) that should map to this column — this covers the
 * literal field name plus the Measure Names/Measure Values aliases Tableau
 * uses when "Component" is really a pivoted measure column. `width` is an
 * optional override for columns that need more room than their label length
 * would suggest (e.g. formatted currency amounts).
 */
const PREFERRED_COLUMNS: Array<{ label: string; match: string[]; width?: number }> = [
  { label: "No", match: ["no"] },
  { label: "Employee ID", match: ["employee id"] },
  { label: "Employee Name", match: ["employee name"] },
  { label: "Organization", match: ["organization"] },
  { label: "PTKP", match: ["ptkp"] },
  { label: "Employee Tax Status", match: ["employee tax status"] },
  { label: "Join Date", match: ["join date"] },
  { label: "Component", match: ["component", "measure names"], width: 16 },
  { label: "Amount", match: ["amount", "measure values", "total_amount", "total amount"], width: 26 }
];

/**
 * Fields that are Tableau plumbing rather than real data — helper calcs kept
 * on a worksheet's Marks card for filtering/logic (e.g. "tax_mode"), or the
 * built-in Measure Names/Measure Values pseudo-fields when a literal column
 * already stands in for them. These are never shown, even in the generic
 * fallback for unrecognized dashboards below.
 */
const ALWAYS_HIDDEN = new Set(["measure names", "measure values", "tax_mode"]);

function widthFor(label: string): number {
  const isNoCol = /^no$/i.test(label);
  let weight = isNoCol ? 4 : Math.max(label.length, 6);
  if (/link|url/i.test(label)) weight += 20;
  return weight;
}

/**
 * Build PDF columns from whatever fields the selected worksheet actually
 * returned.
 *  - If any field matches PREFERRED_COLUMNS, we treat this as a known
 *    dashboard: only the pinned columns are shown, in that order, using the
 *    pinned label/width. Any other field on the worksheet (helper calcs,
 *    stray pseudo-fields, etc.) is left out on purpose.
 *  - If nothing matches PREFERRED_COLUMNS at all, this is an unrecognized
 *    dashboard: fall back to rendering every returned field generically (minus
 *    the always-hidden plumbing fields) so nothing new silently disappears.
 * Every column is eligible for "grouping" (its cell is blanked when it
 * repeats the row directly above within the same row-number group), which
 * mimics Tableau's own merged-cell look for repeated dimension values.
 */
function resolveColumns(available: string[]): ResolvedCol[] {
  const used = new Set<string>();
  const resolved: ResolvedCol[] = [];

  for (const pref of PREFERRED_COLUMNS) {
    const source = available.find(
      (a) => !used.has(a) && pref.match.includes(cleanLabel(a).toLowerCase())
    );
    if (source) {
      used.add(source);
      resolved.push({
        label: pref.label,
        source,
        group: true,
        width: pref.width ?? widthFor(pref.label)
      });
    }
  }

  if (resolved.length > 0) return resolved;

  // Unrecognized dashboard: generic fallback over every returned field.
  for (const source of available) {
    const label = cleanLabel(source);
    if (ALWAYS_HIDDEN.has(label.toLowerCase())) continue;
    resolved.push({ label, source, group: true, width: widthFor(label) });
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

    if (page.signature && page.signature.length > 0) {
      drawSignatureBlock(doc, page.signature, startX, usableWidth, y);
    }

    doc.end();
  });
}

/**
 * Draws the "Prepared by / Approved by / Approved by / Acknowledged by"
 * sign-off block below the table: one evenly-spaced column per entry, a role
 * caption, blank space for a physical signature, and the name in parentheses.
 * Starts a new page if there isn't enough room left on the current one.
 */
function drawSignatureBlock(
  doc: PDFKit.PDFDocument,
  entries: SignatureEntry[],
  startX: number,
  usableWidth: number,
  currentY: number
): void {
  const blockHeight = 110; // title + signing space + name
  const topGap = 24;
  let y = currentY + topGap;

  if (y + blockHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage({ margin: 30, size: "A4", layout: "landscape" });
    y = doc.page.margins.top + topGap;
  } else {
    doc.moveTo(startX, currentY + 10).lineTo(startX + usableWidth, currentY + 10).lineWidth(0.7).strokeColor("#999").stroke();
  }

  const colW = usableWidth / entries.length;

  entries.forEach((e, i) => {
    const cx = startX + i * colW;

    doc.font("Helvetica").fontSize(10).fillColor("#111");
    doc.text(e.title, cx, y, { width: colW, align: "center" });
    doc.font("Helvetica-Bold").fontSize(10);
    doc.text(e.role, cx, y + 14, { width: colW, align: "center" });

    // Signing space, then the resolved name.
    doc.font("Helvetica").fontSize(10);
    doc.text(`( ${e.name} )`, cx, y + 70, { width: colW, align: "center" });
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
