/**
 * PDF rendering for the export. Kept as a plain module (no Next.js imports)
 * so it can be unit-tested directly with `tsx`, without needing the dev
 * server running — `route.ts` is just a thin HTTP wrapper around
 * `renderAllPages`/`renderCompact` below.
 */

import PDFDocument from "pdfkit";
import type { ColumnSpec, LogoSpec } from "./dashboardConfigs";

export const PAGE_OPTS = { margin: 30, size: "A4", layout: "landscape" } as const;
// Buffering pages lets us go back (via switchToPage) after the whole
// document is drawn and fill in "Page X of Y" once the true total is known.
const DOC_OPTS = { ...PAGE_OPTS, bufferPages: true } as const;

export interface SignatureEntry {
  title: string;
  role: string;
  name: string;
}

export interface ReportHeader {
  lines: string[];
  period?: string;
}

export interface PageData {
  pageNumber: string;
  title: string;
  columns: string[];
  rows: Array<Record<string, string>>;
  header?: ReportHeader;
  signature?: SignatureEntry[];
}

export interface ExportMeta {
  /** "DD-MM-YYYY hh:mm", resolved at export time. */
  generatedAt: string;
  printedBy?: string;
  logo?: LogoSpec;
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
 * Fields that are Tableau plumbing rather than real data — helper calcs kept
 * on a worksheet's Marks card for filtering/logic (e.g. "tax_mode"), or the
 * built-in Measure Names/Measure Values pseudo-fields when a literal column
 * already stands in for them. These are never shown in the generic fallback
 * for dashboards that don't declare a column layout in their config.
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
 *  - If the dashboard's config provides a `layout`, only those columns are
 *    shown, in that order, with the configured label/width. Any other field
 *    on the worksheet (helper calcs, stray pseudo-fields, etc.) is left out.
 *  - If no layout is provided (or none of its columns match), fall back to
 *    rendering every returned field generically (minus the always-hidden
 *    plumbing fields), so a new dashboard works with zero route changes.
 * Every column is eligible for "grouping" (its cell is blanked when it
 * repeats the row directly above within the same row-number group), which
 * mimics Tableau's own merged-cell look for repeated dimension values.
 */
function resolveColumns(available: string[], layout?: ColumnSpec[]): ResolvedCol[] {
  const used = new Set<string>();
  const resolved: ResolvedCol[] = [];

  if (layout && layout.length > 0) {
    for (const pref of layout) {
      const matches = pref.match.map((m) => m.toLowerCase());
      const source = available.find(
        (a) => !used.has(a) && matches.includes(cleanLabel(a).toLowerCase())
      );
      if (source) {
        used.add(source);
        resolved.push({
          label: pref.label,
          source,
          group: pref.group ?? true,
          width: pref.width ?? widthFor(pref.label)
        });
      }
    }
    if (resolved.length > 0) return resolved;
  }

  // No layout, or nothing matched: generic fallback over every returned field.
  for (const source of available) {
    const label = cleanLabel(source);
    if (ALWAYS_HIDDEN.has(label.toLowerCase())) continue;
    resolved.push({ label, source, group: true, width: widthFor(label) });
  }

  return resolved;
}

const ROW_HEIGHT = 16;
const TABLE_HEADER_HEIGHT = 20;
const META_LINE_HEIGHT = 11;
const CELL_MAX_FONT = 8;
const CELL_MIN_FONT = 6;

/**
 * Picks the largest font size (between CELL_MAX_FONT and CELL_MIN_FONT, in
 * 0.5pt steps) at which `text` fits within `maxWidth` without wrapping —
 * e.g. a long formatted number ("12,345,678.90") shrinks just enough to fit
 * its column instead of being cut off with "...". Falls back to
 * CELL_MIN_FONT (still capped by `ellipsis: true` at draw time) if even the
 * smallest size doesn't fit.
 */
function fittedFontSize(doc: PDFKit.PDFDocument, text: string, maxWidth: number): number {
  if (!text) return CELL_MAX_FONT;
  for (let size = CELL_MAX_FONT; size >= CELL_MIN_FONT; size -= 0.5) {
    doc.font("Helvetica").fontSize(size);
    if (doc.widthOfString(text) <= maxWidth) return size;
  }
  return CELL_MIN_FONT;
}

/** The fixed "Print date"/"Print by" lines (excludes the "Page X of Y" line,
 * whose text isn't known until the whole document is drawn — see
 * `drawPageNumbers`). Shared between `drawChrome` (which reserves the space)
 * and `drawPageNumbers` (which fills the reserved line in) so they can never
 * drift out of sync. */
function fixedMetaLines(meta: ExportMeta | undefined): string[] {
  const lines: string[] = [];
  if (meta?.generatedAt) lines.push(`Print date : ${meta.generatedAt}`);
  if (meta?.printedBy) lines.push(`Print by: ${meta.printedBy}`);
  return lines;
}

/**
 * Draws the "page chrome" shared by every physical PDF page: the logo on
 * the left, the dashboard's own centered letterhead (`header.lines` +
 * "Period X to Y"), and the "Print date"/"Print by"/"Page X of Y" block
 * top-right (from `meta`; the page number's actual text is filled in later
 * by `drawPageNumbers`, only the space for it is reserved here). All three
 * blocks share one vertical band and are each centered within it, so on a
 * page with a tall logo the print-date/page-of text sits level with the
 * logo and title's vertical middle instead of being pinned to the very top
 * of the page. Called once whenever a new physical page starts — never per
 * page-group, so packing several groups onto one sheet doesn't repeat the
 * letterhead.
 *
 * If `pageOfPositions` is passed, the y-coordinate chosen for this page's
 * "Page X of Y" line is appended to it (in physical-page order), so
 * `drawPageNumbers` can later fill in that exact line without having to
 * recompute the same layout.
 */
export function drawChrome(
  doc: PDFKit.PDFDocument,
  header: ReportHeader | undefined,
  meta: ExportMeta | undefined,
  logoBuffer: Buffer | null,
  pageOfPositions?: number[]
): void {
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const topY = doc.page.margins.top;

  // --- Pass 1: measure every block before drawing any of them. ---

  // "Print date"/"Print by" text height, plus one reserved blank line for
  // "Page X of Y" (drawn later, once the true page count is known).
  const metaLines = meta ? fixedMetaLines(meta) : [];
  const reservedLines = meta ? metaLines.length + 1 : 0; // +1 for "Page X of Y"
  const metaBlockHeight = reservedLines * META_LINE_HEIGHT;

  // Logo's rendered size (aspect-ratio preserved fit within the configured box).
  let logoW = 0;
  let logoH = 0;
  let logoImg: { width: number; height: number } | null = null;
  if (logoBuffer) {
    const maxLogoW = meta?.logo?.maxWidth ?? 70;
    const maxLogoH = meta?.logo?.maxHeight ?? 40;
    try {
      // `openImage` exists at runtime but isn't in PDFKit's type definitions.
      logoImg = (doc as any).openImage(logoBuffer);
      const scale = Math.min(maxLogoW / logoImg!.width, maxLogoH / logoImg!.height);
      logoW = logoImg!.width * scale;
      logoH = logoImg!.height * scale;
    } catch (err: any) {
      // Corrupt/unreadable image — skip the logo rather than failing the
      // export, but log it: PDFKit's built-in PNG/JPEG decoder can choke on
      // some files (e.g. 16-bit PNGs, certain interlaced/indexed PNGs) with
      // no other indication something's wrong.
      console.warn(`Logo image failed to render (export continues without it). Reason: ${err?.message || err}`);
      logoImg = null;
    }
  }

  // Letterhead text height, measured without drawing (doc.heightOfString
  // reads the currently-set font/size, so set it the same way it'll actually
  // be drawn in pass 2 below).
  let titleContentHeight = 0;
  const hasHeader = !!header && (header.lines.length > 0 || !!header.period);
  if (hasHeader && header) {
    header.lines.forEach((line, i) => {
      doc.font("Helvetica-Bold").fontSize(i === 0 ? 14 : 11);
      titleContentHeight += doc.heightOfString(line, { width: usableWidth, align: "center" });
    });
    if (header.period) {
      titleContentHeight += doc.currentLineHeight() * 0.15; // matches moveDown(0.15) below
      doc.font("Helvetica").fontSize(9);
      titleContentHeight += doc.heightOfString(header.period, { width: usableWidth, align: "center" });
    }
  }

  // Shared band: every block (logo, letterhead, meta text) is vertically
  // centered against whichever of the three is tallest, all starting from
  // the same topY — instead of the meta block being pinned to the page's
  // very top while logo/title sit lower.
  const bandHeight = Math.max(logoH, titleContentHeight, metaBlockHeight);

  // --- Pass 2: draw every block, each centered within the shared band. ---

  if (metaLines.length > 0 || reservedLines > 0) {
    const metaY = topY + Math.max(0, (bandHeight - metaBlockHeight) / 2);
    doc.font("Helvetica").fontSize(8).fillColor("#333");
    let my = metaY;
    for (const line of metaLines) {
      doc.text(line, startX, my, { width: usableWidth, align: "right" });
      my += META_LINE_HEIGHT;
    }
    if (reservedLines > 0) {
      // Reserve (but don't draw yet) the "Page X of Y" line — its position
      // is recorded so `drawPageNumbers` can fill it in later.
      const pageOfY = metaY + metaLines.length * META_LINE_HEIGHT;
      pageOfPositions?.push(pageOfY);
    }
  }

  if (logoBuffer && logoImg) {
    const logoY = topY + Math.max(0, (bandHeight - logoH) / 2);
    doc.image(logoBuffer, startX, logoY, { width: logoW, height: logoH });
  }

  if (hasHeader && header) {
    doc.y = topY + Math.max(0, (bandHeight - titleContentHeight) / 2);
    header.lines.forEach((line, i) => {
      doc
        .font("Helvetica-Bold")
        .fontSize(i === 0 ? 14 : 11)
        .fillColor("#111")
        .text(line, startX, doc.y, { width: usableWidth, align: "center" });
    });
    if (header.period) {
      doc.moveDown(0.15);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor("#333")
        .text(header.period, startX, doc.y, { width: usableWidth, align: "center" });
    }
  }

  // Continue below the shared band (whichever of logo/letterhead/meta is
  // tallest), plus a little breathing room before the table.
  doc.y = topY + bandHeight + 8;
}

/**
 * Second pass, called once right before `doc.end()`: fills in "Page X of Y"
 * on every physical page, at the y-coordinate `drawChrome` reserved and
 * recorded (in physical-page order) into `positions`. Requires the document
 * to have been created with `bufferPages: true`. Safe to call even if
 * `meta` is undefined (no-op).
 */
function drawPageNumbers(doc: PDFKit.PDFDocument, meta: ExportMeta | undefined, positions: number[]): void {
  if (!meta) return;
  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = positions[i] ?? doc.page.margins.top;
    doc.font("Helvetica").fontSize(8).fillColor("#333");
    doc.text(`Page ${i + 1} of ${range.count}`, startX, y, { width: usableWidth, align: "right" });
  }
}

/** Draws the table's own column-header row at `y`. Returns the y position
 * right after it (where the first data row should start). */
function drawTableHeaderRow(
  doc: PDFKit.PDFDocument,
  startX: number,
  usableWidth: number,
  cols: ResolvedCol[],
  colX: number[],
  colW: number[],
  y: number
): number {
  doc.rect(startX, y, usableWidth, TABLE_HEADER_HEIGHT).fill("#f0f0f0");
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#111");
  cols.forEach((c, i) => {
    doc.text(c.label, colX[i] + 3, y + 6, { width: colW[i] - 6, height: TABLE_HEADER_HEIGHT, ellipsis: true, lineBreak: false });
  });
  doc.moveTo(startX, y + TABLE_HEADER_HEIGHT).lineTo(startX + usableWidth, y + TABLE_HEADER_HEIGHT).lineWidth(0.7).strokeColor("#999").stroke();
  return y + TABLE_HEADER_HEIGHT;
}

/**
 * Rough height (points) a page-group's title + table + optional signature
 * block will need, used only to decide whether it fits in the space left on
 * the current physical page. Doesn't need to be exact — the per-row overflow
 * check inside `drawRows` is the real safety net if this underestimates.
 */
export function estimateGroupHeight(page: PageData): number {
  const titleHeight = 15 + 8; // title font size + moveDown(0.4) gap, approx
  const tableHeight = TABLE_HEADER_HEIGHT + page.rows.length * ROW_HEIGHT;
  const signatureHeight = page.signature && page.signature.length > 0 ? 110 + 24 : 0;
  return titleHeight + tableHeight + signatureHeight;
}

/**
 * Draws `rows` into the table starting at `startY`, breaking to a new
 * physical page via `onBreak` at "No"-group boundaries whenever the whole
 * next group (e.g. one employee's full set of components) wouldn't fit in
 * what's left on the page — so a group is only ever split mid-way if it's
 * too large to fit on one fresh page by itself (safety net). `onBreak` must
 * perform `doc.addPage(...)` plus whatever the caller wants repeated on
 * every page (just the table's own column header for the classic per-group
 * renderer, or full chrome + title for the compact renderer), and return the
 * y position rows should resume at. Returns the final y after the last row.
 */
function drawRows(
  doc: PDFKit.PDFDocument,
  rows: Array<Record<string, string>>,
  cols: ResolvedCol[],
  colX: number[],
  colW: number[],
  startX: number,
  usableWidth: number,
  startY: number,
  onBreak: () => number
): number {
  let y = startY;
  let pageTopY = startY; // updated whenever onBreak() runs

  const bottomLimit = () => doc.page.height - doc.page.margins.bottom;

  // The "No" source identifies lead-group boundaries.
  const noCol = cols.find((c) => c.label === "No");

  // For each row, the size (row count) of the "No" group it belongs to.
  // Rows sharing the same "No" are assumed contiguous (guaranteed by
  // pagination/rowSort upstream).
  const groupSizeAt: number[] = new Array(rows.length).fill(1);
  {
    const keyOf = (i: number) => (noCol ? rows[i][noCol.source] ?? "" : String(i));
    let i = 0;
    while (i < rows.length) {
      const key = keyOf(i);
      let j = i;
      while (j < rows.length && keyOf(j) === key) j++;
      for (let k = i; k < j; k++) groupSizeAt[k] = j - i;
      i = j;
    }
  }

  let prevRow: Record<string, string> | null = null;
  let prevNo: string | null = null;

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const curNo = noCol ? row[noCol.source] ?? "" : String(r);
    const isNewGroup = curNo !== prevNo;

    if (isNewGroup) {
      const atFreshPageTop = y <= pageTopY + 0.01;
      const groupHeight = groupSizeAt[r] * ROW_HEIGHT;
      if (!atFreshPageTop && y + groupHeight > bottomLimit()) {
        y = onBreak();
        pageTopY = y;
        prevRow = null;
        prevNo = null;
      }
    }

    // Safety net: a single group so large it can't fit on one fresh page at
    // all still has to split — this just prevents drawing past the margin.
    if (y + ROW_HEIGHT > bottomLimit()) {
      y = onBreak();
      pageTopY = y;
      prevRow = null;
      prevNo = null;
    }

    // Separator line between lead groups (skip right at the top of a fresh page).
    if (isNewGroup && r > 0 && y > pageTopY + 0.01) {
      doc.moveTo(startX, y).lineTo(startX + usableWidth, y).lineWidth(0.5).strokeColor("#ccc").stroke();
    }

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

      const cellText = String(value).slice(0, 120);
      const availWidth = colW[i] - 6;
      // Shrink the font just enough to fit long values (e.g. formatted
      // amounts) before falling back to "..." — avoids visually truncating
      // numbers that would otherwise fit fine one size down.
      const size = fittedFontSize(doc, cellText, availWidth);
      doc.font("Helvetica").fontSize(size).fillColor("#111");
      doc.text(cellText, colX[i] + 3, y + 3 + (CELL_MAX_FONT - size) * 0.4, {
        width: availWidth,
        height: ROW_HEIGHT,
        ellipsis: true,
        lineBreak: false
      });
    });

    prevRow = row;
    prevNo = curNo;
    y += ROW_HEIGHT;
  }

  return y;
}

/** Computes the column layout (positions/widths) for a resolved column set. */
function layoutColumns(cols: ResolvedCol[], startX: number, usableWidth: number): { colX: number[]; colW: number[] } {
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
  return { colX, colW };
}

/**
 * Draws one page-group's title + table (+ optional trailing signature block)
 * starting at the document's current `doc.y`, on the current physical page —
 * it never starts a fresh page itself except when a group's own rows overflow
 * past the bottom margin mid-table (continuation pages), in which case it
 * redraws just the table's column header (not the outer chrome/letterhead).
 */
export function drawGroupBody(doc: PDFKit.PDFDocument, page: PageData, layout?: ColumnSpec[]): void {
  const cols = resolveColumns(page.columns, layout);

  doc.fontSize(15).font("Helvetica-Bold").fillColor("#111").text(page.title);
  doc.moveDown(0.4);

  const startX = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const { colX, colW } = layoutColumns(cols, startX, usableWidth);

  let y = drawTableHeaderRow(doc, startX, usableWidth, cols, colX, colW, doc.y);

  const onBreak = (): number => {
    doc.addPage(PAGE_OPTS);
    return drawTableHeaderRow(doc, startX, usableWidth, cols, colX, colW, doc.page.margins.top);
  };

  y = drawRows(doc, page.rows, cols, colX, colW, startX, usableWidth, y, onBreak);
  doc.y = y;

  if (page.signature && page.signature.length > 0) {
    drawSignatureBlock(doc, page.signature, startX, usableWidth, y);
  }
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
    doc.addPage(PAGE_OPTS);
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

/**
 * Renders every page-group into a single multi-page PDF, but compactly:
 * groups are packed onto the same physical page as long as there's room, and
 * a new physical page is only started when the next group wouldn't fit
 * (using `estimateGroupHeight` as a fast pre-check). Each new physical page
 * redraws the shared chrome (logo, print date/by, letterhead) once; packed
 * groups on the same page are separated by a thin divider instead of
 * repeating the chrome. This keeps every group at most one page wide (A4
 * landscape, one column layout) and avoids blank pages left over from
 * short groups (e.g. a page-size-2 dashboard whose last group only has 1 row).
 *
 * Use this for dashboards keyed by Tableau's own Page/No field — the ones
 * NOT using `compactPacking`. For fully dynamic, per-employee packing across
 * the whole report regardless of Tableau's own page boundaries, see
 * `renderCompact` instead.
 */
export function renderAllPages(
  pages: PageData[],
  layout: ColumnSpec[] | undefined,
  meta: ExportMeta | undefined,
  logoBuffer: Buffer | null
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(DOC_OPTS);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const bottom = () => doc.page.height - doc.page.margins.bottom;
    const pageOfPositions: number[] = [];

    let onFreshPage = true;

    pages.forEach((page) => {
      const needed = estimateGroupHeight(page);

      if (onFreshPage) {
        // Very first group, or the first group after a forced page break —
        // either way the chrome hasn't been drawn for this physical page yet.
        drawChrome(doc, page.header, meta, logoBuffer, pageOfPositions);
        onFreshPage = false;
      } else if (doc.y + needed > bottom()) {
        // Doesn't fit what's left on this page — start a new one.
        doc.addPage(PAGE_OPTS);
        drawChrome(doc, page.header, meta, logoBuffer, pageOfPositions);
      } else {
        // Fits — pack it onto the current page below the previous group,
        // separated by a divider instead of repeating the letterhead.
        doc.moveTo(startX, doc.y + 4).lineTo(startX + usableWidth, doc.y + 4).lineWidth(0.7).strokeColor("#999").stroke();
        doc.y += 14;
      }

      drawGroupBody(doc, page, layout);
    });

    drawPageNumbers(doc, meta, pageOfPositions);
    doc.end();
  });
}

/**
 * Fully dynamic/compact renderer: ignores Tableau's own Page/No pagination
 * entirely. `rows` is the WHOLE report's data (already row-sorted upstream),
 * treated as one continuous stream. Employee/lead groups ("No" boundaries)
 * are packed onto physical pages purely by how much actually fits — e.g. if
 * one page has room for 4 short employees, it gets 4; if the next employee
 * is long, it may only fit 1 on its page. Chrome (logo/letterhead/print
 * date/"Page X of Y") is redrawn on every new page; there's no separate
 * per-page title line (the true physical page number already shows in
 * "Page X of Y", so repeating it as a title would just be redundant/
 * confusing, as Tableau's own per-group page numbers were before this).
 */
export function renderCompact(
  rows: Array<Record<string, string>>,
  columns: string[],
  header: ReportHeader | undefined,
  layout: ColumnSpec[] | undefined,
  meta: ExportMeta | undefined,
  logoBuffer: Buffer | null,
  signature: SignatureEntry[] | undefined
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(DOC_OPTS);
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const cols = resolveColumns(columns, layout);
    const startX = doc.page.margins.left;
    const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const { colX, colW } = layoutColumns(cols, startX, usableWidth);
    const pageOfPositions: number[] = [];

    // Draws chrome + table header on whatever is currently the active
    // physical page. Returns the y to resume rows at.
    const drawPageStart = (): number => {
      drawChrome(doc, header, meta, logoBuffer, pageOfPositions);
      return drawTableHeaderRow(doc, startX, usableWidth, cols, colX, colW, doc.y);
    };

    let y = drawPageStart();

    const onBreak = (): number => {
      doc.addPage(PAGE_OPTS);
      return drawPageStart();
    };

    y = drawRows(doc, rows, cols, colX, colW, startX, usableWidth, y, onBreak);

    if (signature && signature.length > 0) {
      drawSignatureBlock(doc, signature, startX, usableWidth, y);
    }

    drawPageNumbers(doc, meta, pageOfPositions);
    doc.end();
  });
}