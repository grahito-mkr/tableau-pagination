/**
 * Export orchestrator.
 *
 * Model (correct for this dashboard):
 *  - The dashboard already computes a Page number per row via a calc
 *    ( Page = round-up of No/5 ). That Page value is a real column in the
 *    underlying data.
 *  - The user's date/channel filters define WHICH rows exist. We never touch
 *    those.
 *  - The Page control filter, however, restricts the underlying data to the
 *    currently-selected page(s). To export every page we temporarily clear the
 *    Page filter, read all rows, then restore the user's original Page
 *    selection so the dashboard looks untouched.
 *  - We group the returned rows by their Page value and emit one PDF per page.
 *
 * If clearing/restoring the Page filter fails or isn't wanted, the export still
 * works on whatever rows come back (falling back to grouping by page value).
 */

import { TableauClient, type DataRow } from "./tableauClient";

/** One column of the signature block, e.g. "Prepared by / Admin & Payroll / (Name)". */
export interface SignatureEntry {
  title: string; // e.g. "Prepared by"
  role: string; // e.g. "Admin & Payroll" — also the Tableau Parameter name to read
  name: string; // resolved current value of that parameter
}

/**
 * The dashboard's sign-off block is driven by four Tableau Parameters (visible
 * as dropdowns on the dashboard), not by worksheet row data. `role` doubles as
 * the exact Parameter name to look up.
 */
const SIGNATURE_SPEC: Array<{ title: string; role: string }> = [
  { title: "Prepared by", role: "Admin & Payroll" },
  { title: "Approved by", role: "DOF" },
  { title: "Approved by", role: "DOHR" },
  { title: "Acknowledged by", role: "GM" }
];

/**
 * Names of the two Tableau Parameters that drive the "Period X to Y" line
 * shown on the dashboard. Best-effort: if these parameters don't exist on a
 * given dashboard, the period line is simply omitted.
 */
const PERIOD_PARAMS = { start: "Start Date", end: "End Date" };

/** Static letterhead lines (company name, report title, ...) plus the
 * resolved "Period X to Y" line, repeated on every page like the dashboard's
 * own header. */
export interface ReportHeader {
  lines: string[];
  period?: string;
}

export interface PageData {
  pageNumber: string;
  title: string;
  columns: string[];
  rows: DataRow[];
  /** Repeated on every page — mirrors the dashboard's own letterhead. */
  header?: ReportHeader;
  /** Present only on the last page of the whole export; rendered as a
   * sign-off block after the table on that page's final PDF page. */
  signature?: SignatureEntry[];
}

export interface ExportOptions {
  /**
   * How pages are determined:
   *  - "field": group by an existing page column's value (pageField). This is
   *    the preferred, portable option — it uses whatever formula the dashboard
   *    itself computed (including any Page Size parameter), so it works on any
   *    dashboard with no code changes. Requires the page calc to be present in
   *    the worksheet's data (e.g. dropped onto the Marks "Detail" shelf).
   *  - "computeFromNo": no Page column is available, so compute the page from
   *    the row-number field using the standard pagination formula:
   *      page = INT((No - 1) / pageSize) + 1
   *    pageSize must match the dashboard's Page Size (parameter) for the pages
   *    to line up.
   */
  mode: "field" | "computeFromNo";
  /** Column to group by when mode === "field" (e.g. "Page" or "AGG(Page)"). */
  pageField?: string;
  /** Column holding the row number when mode === "computeFromNo" (e.g. "AGG(No)"). */
  numberField?: string;
  /** Rows per page when mode === "computeFromNo". Must match the dashboard. */
  pageSize?: number;
  /** Base title for each PDF; the page number is appended. */
  titleBase: string;
  /** Static letterhead lines (e.g. company name, report title) shown at the
   * top of every page, above the "Period X to Y" line (auto-fetched from the
   * Start Date/End Date parameters). Leave empty/omit to show no letterhead. */
  headerLines?: string[];
  onProgress?: (message: string) => void;
}

/**
 * Standard pagination formula: page = INT((No - 1) / pageSize) + 1.
 * Matches the common Tableau calc `INT(([No]-1)/[Page Size])+1`.
 */
function computePage(no: number, pageSize: number): number {
  const size = pageSize > 0 ? pageSize : 1;
  return Math.trunc((no - 1) / size) + 1;
}

/** Parse a numeric value out of a formatted cell string like "1,234" or "12". */
function parseNumber(value: string): number | null {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export class ExportOrchestrator {
  constructor(private client: TableauClient) {}

  /**
   * Build the per-page payload from the underlying data.
   */
  async buildPages(options: ExportOptions): Promise<{ pages: PageData[]; truncated: boolean }> {
    const { mode, pageField, numberField, titleBase, headerLines, onProgress } = options;
    const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : 5;

    onProgress?.("Reading data...");
    const { columns, rows, truncated } = await this.client.getRows();

    if (rows.length === 0) {
      throw new Error(
        "No rows were returned. Check that the worksheet has data for the current filters."
      );
    }

    // Determine which column we read, and validate it exists.
    const sourceField = mode === "computeFromNo" ? numberField : pageField;
    if (!sourceField || !columns.includes(sourceField)) {
      throw new Error(
        `Field "${sourceField}" was not found. Available fields: ${columns.join(", ")}`
      );
    }

    onProgress?.("Grouping by page...");

    // Compute a page key for each row depending on the mode.
    const keyForRow = (row: DataRow): string => {
      if (mode === "computeFromNo") {
        const no = parseNumber(row[sourceField]);
        return no == null ? "" : String(computePage(no, pageSize));
      }
      return row[sourceField] ?? "";
    };

    // Group rows by page key, preserving first-seen order.
    const groups = new Map<string, DataRow[]>();
    for (const row of rows) {
      const key = keyForRow(row);
      if (key === "") continue; // skip rows we can't place
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }

    if (groups.size === 0) {
      throw new Error(
        `Could not determine any page numbers from "${sourceField}". ` +
          `Check that the selected field contains numeric row numbers.`
      );
    }

    // Sort page keys numerically when possible, else lexically.
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });

    // Sanity guard: catch an obviously-wrong field (e.g. a unique per-row id
    // that would yield one "page" per row). Legitimate reports here can have
    // ~1000 pages, so the ceiling is high; it only trips on clearly-wrong input
    // where distinct values approach the row count.
    const distinctRatio = sortedKeys.length / rows.length;
    if (sortedKeys.length > 2000 || (sortedKeys.length > 300 && distinctRatio > 0.9)) {
      const sample = sortedKeys.slice(0, 8).join(", ");
      throw new Error(
        `Field produced ${sortedKeys.length} groups from ${rows.length} rows ` +
          `(sample: ${sample}...). That looks like a per-row id rather than a page number. ` +
          `If you meant to compute pages from the row number, choose "Compute from row number".`
      );
    }

    const pages: PageData[] = sortedKeys.map((key) => ({
      pageNumber: key,
      title: `${titleBase} - Page ${key}`,
      columns,
      rows: groups.get(key)!
    }));

    // Letterhead header: static lines from the UI, plus the "Period X to Y"
    // line auto-resolved from the Start Date/End Date Parameters (best
    // effort — omitted if those parameters don't exist on this dashboard).
    // Repeated on every page, mirroring the dashboard's own header.
    const staticLines = (headerLines ?? []).map((l) => l.trim()).filter(Boolean);
    onProgress?.("Reading report header...");
    const periodValues = await this.client.getParameterValues([PERIOD_PARAMS.start, PERIOD_PARAMS.end]);
    const periodStart = periodValues[PERIOD_PARAMS.start];
    const periodEnd = periodValues[PERIOD_PARAMS.end];
    const period = periodStart && periodEnd ? `Period ${periodStart} to ${periodEnd}` : undefined;

    if (staticLines.length > 0 || period) {
      const header: ReportHeader = { lines: staticLines, period };
      for (const p of pages) p.header = header;
    }

    // Signature block: read the four sign-off Parameters (best effort — if
    // they're missing on this dashboard, the block is simply omitted rather
    // than failing the export) and attach to the last page only.
    onProgress?.("Reading signature block...");
    const paramValues = await this.client.getParameterValues(SIGNATURE_SPEC.map((s) => s.role));
    const signature: SignatureEntry[] = SIGNATURE_SPEC.filter((s) => paramValues[s.role] != null).map(
      (s) => ({ title: s.title, role: s.role, name: paramValues[s.role] })
    );
    if (signature.length > 0 && pages.length > 0) {
      pages[pages.length - 1].signature = signature;
    }

    return { pages, truncated };
  }

  /**
   * Full export: build pages, POST to backend, return the PDF blob.
   */
  async export(options: ExportOptions): Promise<Blob> {
    const { pages, truncated } = await this.buildPages(options);

    options.onProgress?.(`Generating ${pages.length} PDF${pages.length === 1 ? "" : "s"}...`);

    const response = await fetch("/api/export-pdfs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages })
    });

    if (!response.ok) {
      let msg = `Export failed (HTTP ${response.status})`;
      try {
        const err = await response.json();
        if (err?.error) msg = `Export failed: ${err.error}`;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }

    if (truncated) {
      options.onProgress?.("Note: data was capped at 10,000 rows.");
    }

    return response.blob();
  }
}
