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
import type { ColumnSpec, RowSortSpec, LogoSpec } from "./dashboardConfigs";

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

/** Whole-export metadata drawn once per physical PDF page: logo top-left,
 * "Print date"/"Print by" top-right. */
export interface ExportMeta {
  /** "DD-MM-YYYY hh:mm", resolved at export time. */
  generatedAt: string;
  /** Resolved value of the configured `printedByMatch` field, if found. */
  printedBy?: string;
  logo?: LogoSpec;
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
  /** PDF column layout (which columns, order, labels, widths) passed straight
   * through to the API route. Omit to render every returned field generically. */
  columnLayout?: ColumnSpec[];
  /** Optional row ordering applied within each "No" group before pagination —
   * see RowSortSpec. Omit to keep the order Tableau's summary-data query
   * returns. */
  rowSort?: RowSortSpec;
  /** Logo shown top-left of every physical PDF page. Omit to show no logo. */
  logo?: LogoSpec;
  /** Alias list identifying the worksheet field holding the current viewer's
   * username, shown top-right as "Print by: <value>". Omit to hide it. */
  printedByMatch?: string[];
  /** Alias lists identifying worksheet fields (columns) holding the report's
   * period, e.g. "Period Start"/"Period End" — resolved from the first
   * exported row, same as `printedByMatch`. Takes priority over the
   * Start Date/End Date Parameter lookup below; set this when the period is
   * a worksheet column rather than a dashboard Parameter. */
  periodMatch?: { start: string[]; end: string[] };
  /** When true, ignore `mode`/`pageField`/`numberField`/`pageSize` entirely
   * and hand the WHOLE row set (already row-sorted) to the compact renderer,
   * which packs "No" groups onto physical pages purely by how much fits. */
  compactPacking?: boolean;
  onProgress?: (message: string) => void;
}

/** Formats a Date as "DD-MM-YYYY HH:mm" in Asia/Jakarta (WIB, UTC+7), regardless
 * of the server's own timezone. */
function formatPrintDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")}-${get("month")}-${get("year")} ${get("hour")}:${get("minute")}`;
}

/** Strip a Tableau aggregation wrapper and lowercase, e.g. "AGG(Tax_Mode)" -> "tax_mode". */
function cleanInner(name: string): string {
  const m = name.match(/^[A-Za-z]+\(([^)]+)\)\s*$/);
  return (m ? m[1] : name).trim().toLowerCase();
}

/** Find the first column whose cleaned inner name matches any alias in `match`. */
function findColumnByMatch(columns: string[], match: string[]): string | undefined {
  const wanted = match.map((m) => m.toLowerCase());
  return columns.find((c) => wanted.includes(cleanInner(c)));
}

/** Find the value in a Parameter-name-keyed map whose key matches any alias
 * in `aliases` (case-insensitive) — `getParameterValues` returns keys with
 * their real on-dashboard casing, which won't necessarily match a lowercase
 * alias list directly. */
function pickByAlias(values: Record<string, string>, aliases: string[]): string | undefined {
  const wanted = new Set(aliases.map((a) => a.toLowerCase()));
  for (const key of Object.keys(values)) {
    if (wanted.has(key.toLowerCase())) return values[key];
  }
  return undefined;
}

/**
 * Reorders rows within each "No" group according to `spec`: first by a fixed
 * manual priority list (e.g. tax_mode category order), then alphabetically as
 * a tiebreaker. Rows are never moved across "No" groups — only the order of
 * rows sharing the same "No" value changes, and groups themselves keep their
 * original first-seen order. If the configured field(s) aren't found, or no
 * spec is given, the rows are returned unchanged.
 */
function applyRowSort(rows: DataRow[], columns: string[], spec?: RowSortSpec): DataRow[] {
  if (!spec) return rows;
  const sortCol = findColumnByMatch(columns, spec.match);
  if (!sortCol) return rows;
  const alphaCol = spec.thenAlphabetical ? findColumnByMatch(columns, spec.thenAlphabetical.match) : undefined;
  const noCol = findColumnByMatch(columns, ["no"]);

  const rank = new Map(spec.order.map((v, i) => [v.toLowerCase(), i]));
  const rankFor = (v: string) => rank.get(v.toLowerCase()) ?? spec.order.length;

  // Partition into consecutive-by-appearance groups keyed by "No", preserving
  // first-seen group order.
  const groupOrder: string[] = [];
  const groups = new Map<string, DataRow[]>();
  for (const row of rows) {
    const key = noCol ? row[noCol] ?? "" : "";
    if (!groups.has(key)) {
      groups.set(key, []);
      groupOrder.push(key);
    }
    groups.get(key)!.push(row);
  }

  const result: DataRow[] = [];
  for (const key of groupOrder) {
    const group = groups.get(key)!;
    const ordered = group
      .map((row, i) => ({ row, i })) // keep original index as a stable tiebreak
      .sort((a, b) => {
        const ra = rankFor(a.row[sortCol] ?? "");
        const rb = rankFor(b.row[sortCol] ?? "");
        if (ra !== rb) return ra - rb;
        if (alphaCol) {
          const va = (a.row[alphaCol] ?? "").toLowerCase();
          const vb = (b.row[alphaCol] ?? "").toLowerCase();
          if (va !== vb) return va < vb ? -1 : 1;
        }
        return a.i - b.i;
      })
      .map((x) => x.row);
    result.push(...ordered);
  }
  return result;
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
   * Human-readable diagnostics from the most recent `buildPages`/`export`
   * call — e.g. "Print by"/"Period" fields that didn't resolve. These are
   * also `console.warn`'d as they happen (for anyone who does have DevTools
   * open), but reading this array after `export()` resolves is the easier
   * path when testing directly inside Tableau Desktop, where opening the
   * embedded extension's DevTools isn't always straightforward. Reset at
   * the start of every `buildPages` call.
   */
  lastWarnings: string[] = [];

  /**
   * The resolved "Period <start> to <end>" line from the most recent
   * `buildPages` call (same value shown under the letterhead), or undefined
   * if it couldn't be resolved. Handy for building a descriptive download
   * filename without re-deriving it. Reset at the start of every
   * `buildPages` call.
   */
  lastPeriodLabel: string | undefined;

  private warn(message: string): void {
    this.lastWarnings.push(message);
    console.warn(message);
  }

  /**
   * Build the per-page payload from the underlying data.
   */
  async buildPages(options: ExportOptions): Promise<{ pages: PageData[]; truncated: boolean; meta: ExportMeta }> {
    this.lastWarnings = [];
    this.lastPeriodLabel = undefined;
    const { mode, pageField, numberField, titleBase, headerLines, onProgress } = options;
    const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : 5;

    onProgress?.("Preparing export...");
    const { columns, rows: rawRows, truncated } = await this.client.getRows();

    if (rawRows.length === 0) {
      throw new Error(
        "No rows were returned. Check that the worksheet has data for the current filters."
      );
    }

    // Optional per-dashboard row ordering (e.g. Component category order,
    // then alphabetical) applied within each "No" group, before pagination.
    const rows = applyRowSort(rawRows, columns, options.rowSort);

    // Diagnostic: some Component values can end up with a blank Amount even
    // though Tableau shows a value for them in the worksheet. This is NOT a
    // rendering/truncation issue in the PDF (every other Amount renders in
    // full) — it means the specific measure behind that one component isn't
    // included in this worksheet's Measure Values pivot, or resolves to null
    // in this context, so the cell is genuinely empty in the exported data.
    // Log the raw fields for one row per affected component (open the
    // browser console during export) so the actual field name backing that
    // component's amount can be identified and added to the Amount column's
    // `match` aliases if it's simply named differently.
    if (options.columnLayout) {
      const amountSpec = options.columnLayout.find((c) => c.label.toLowerCase() === "amount");
      const componentSpec = options.columnLayout.find((c) => c.label.toLowerCase() === "component");
      const amountCol = amountSpec ? findColumnByMatch(columns, amountSpec.match) : undefined;
      const componentCol = componentSpec ? findColumnByMatch(columns, componentSpec.match) : undefined;
      if (amountCol && componentCol) {
        const seen = new Set<string>();
        for (const row of rows) {
          const comp = (row[componentCol] ?? "").trim();
          const amt = (row[amountCol] ?? "").trim();
          if (comp && !amt && !seen.has(comp)) {
            seen.add(comp);
            this.warn(
              `Component "${comp}" has a blank Amount (resolved from field "${amountCol}"). ` +
                `Raw fields for this row: ${JSON.stringify(row)}`
            );
          }
        }
      }
    }

    // "Print by": resolve the configured username field from the first row
    // (it's a constant per export, e.g. a USERNAME() calc, not a per-row
    // value). Best-effort — omitted if the field isn't found. If it's
    // configured but doesn't resolve, this is almost always because the
    // field is visible in the data source's Tables list but hasn't actually
    // been dropped onto THIS worksheet's Marks/Detail shelf — summary data
    // only includes fields the worksheet itself uses. Logged (not thrown) so
    // the export still completes without the "Print by" line.
    const printedByCol = options.printedByMatch ? findColumnByMatch(columns, options.printedByMatch) : undefined;
    if (options.printedByMatch && !printedByCol) {
      this.warn(
        `"Print by" field not found (looked for: ${options.printedByMatch.join(", ")}). ` +
          `This usually means the field isn't on this worksheet's Marks/Detail shelf yet — ` +
          `being visible in the data source's Tables list isn't enough. ` +
          `Fields available on worksheet "${this.client.worksheetName}": ${columns.join(", ") || "(none)"}.`
      );
    }
    const printedBy = printedByCol ? rawRows[0]?.[printedByCol] : undefined;
    const meta: ExportMeta = {
      generatedAt: formatPrintDate(new Date()),
      printedBy: printedBy || undefined,
      logo: options.logo
    };

    // Letterhead header: static lines from the UI, plus the "Period X to Y"
    // line, tried in order: (1) `periodMatch` as worksheet columns (resolved
    // from the first row, like `printedBy`), (2) `periodMatch`'s alias words
    // as Parameter names instead — a "Period Start"/"Period End" control on
    // the dashboard is very often a Parameter, not a column, even though it
    // looks like a field — (3) the legacy hardcoded "Start Date"/"End Date"
    // Parameter names. Best-effort throughout — if none resolve, the period
    // line is omitted and a console.warn lists every worksheet column AND
    // every dashboard Parameter name that actually exists, to pin down the
    // real one.
    const staticLines = (headerLines ?? []).map((l) => l.trim()).filter(Boolean);

    let period: string | undefined;
    if (options.periodMatch) {
      const startCol = findColumnByMatch(columns, options.periodMatch.start);
      const endCol = findColumnByMatch(columns, options.periodMatch.end);
      const periodStart = startCol ? rawRows[0]?.[startCol] : undefined;
      const periodEnd = endCol ? rawRows[0]?.[endCol] : undefined;
      if (periodStart && periodEnd) period = `Period ${periodStart} to ${periodEnd}`;
    }
    if (!period) {
      onProgress?.("Checking details...");
      const startAliases = [PERIOD_PARAMS.start, ...(options.periodMatch?.start ?? [])];
      const endAliases = [PERIOD_PARAMS.end, ...(options.periodMatch?.end ?? [])];
      const periodValues = await this.client.getParameterValues([...startAliases, ...endAliases]);
      const periodStart = pickByAlias(periodValues, startAliases);
      const periodEnd = pickByAlias(periodValues, endAliases);
      period = periodStart && periodEnd ? `Period ${periodStart} to ${periodEnd}` : undefined;

      if (!period) {
        const paramNames = await this.client.getAllParameterNames();
        this.warn(
          `Period not resolved as either a worksheet column or a dashboard Parameter. ` +
            `Looked for: ${[...new Set([...startAliases, ...endAliases])].join(", ")}. ` +
            `Fields available on worksheet "${this.client.worksheetName}": ${columns.join(", ") || "(none)"}. ` +
            `Parameters available on this dashboard: ${paramNames.join(", ") || "(none)"}.`
        );
      }
    }

    this.lastPeriodLabel = period;

    const header: ReportHeader | undefined =
      staticLines.length > 0 || period ? { lines: staticLines, period } : undefined;

    // Signature block: read the four sign-off Parameters (best effort — if
    // they're missing on this dashboard, the block is simply omitted rather
    // than failing the export).
    const paramValues = await this.client.getParameterValues(SIGNATURE_SPEC.map((s) => s.role));
    const signature: SignatureEntry[] = SIGNATURE_SPEC.filter((s) => paramValues[s.role] != null).map(
      (s) => ({ title: s.title, role: s.role, name: paramValues[s.role] })
    );

    // Compact mode: skip Tableau's own Page/No grouping entirely. Hand the
    // whole (already row-sorted) row set to the compact renderer as a single
    // logical unit — it packs "No" groups onto physical pages purely by how
    // much fits, and computes its own true physical page numbers, instead of
    // however many Tableau "pages" a fixed pageSize produced.
    if (options.compactPacking) {
      const page: PageData = {
        pageNumber: "1",
        title: titleBase,
        columns,
        rows
      };
      if (header) page.header = header;
      if (signature.length > 0) page.signature = signature;
      return { pages: [page], truncated, meta };
    }

    // Determine which column we read, and validate it exists.
    const sourceField = mode === "computeFromNo" ? numberField : pageField;
    if (!sourceField || !columns.includes(sourceField)) {
      throw new Error(
        `Field "${sourceField}" was not found. Available fields: ${columns.join(", ")}`
      );
    }

    onProgress?.("Organizing report...");

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

    // Sanity guard (computeFromNo only): catch an obviously-wrong row-number
    // field — e.g. a unique per-row id that would yield one "page" per row. In
    // "field" mode the config points at an explicit Page column, so we trust
    // it and skip this check. Legitimate reports can have ~1000 pages, so the
    // ceiling is high; it only trips when distinct values approach row count.
    const distinctRatio = sortedKeys.length / rows.length;
    if (
      mode === "computeFromNo" &&
      (sortedKeys.length > 2000 || (sortedKeys.length > 300 && distinctRatio > 0.9))
    ) {
      const sample = sortedKeys.slice(0, 8).join(", ");
      throw new Error(
        `This dashboard's export is misconfigured: the row-number field produced ` +
          `${sortedKeys.length} pages from ${rows.length} rows (sample: ${sample}...), ` +
          `which looks like a per-row id, not a row number. Ask the report admin to fix ` +
          `the dashboard config — set a correct "pageSize", or use "mode": "field" if the ` +
          `worksheet already has a Page column.`
      );
    }

    const pages: PageData[] = sortedKeys.map((key) => ({
      pageNumber: key,
      title: `${titleBase} - Page ${key}`,
      columns,
      rows: groups.get(key)!
    }));

    if (header) {
      for (const p of pages) p.header = header;
    }

    // Attach the signature block to the last page only.
    if (signature.length > 0 && pages.length > 0) {
      pages[pages.length - 1].signature = signature;
    }

    return { pages, truncated, meta };
  }

  /**
   * Full export: build pages, POST to backend, return the PDF blob.
   */
  async export(options: ExportOptions): Promise<Blob> {
    const { pages, truncated, meta } = await this.buildPages(options);

    const payload = JSON.stringify({
      pages,
      layout: options.columnLayout,
      meta,
      compact: !!options.compactPacking,
      // Sent along so the Next.js server can print these to its own
      // terminal (visible in VS Code when running `npm run dev`) — the
      // browser console these were originally warn()'d to is the
      // extension's own embedded webview inside Tableau, which isn't the
      // terminal the dev server runs in.
      warnings: this.lastWarnings
    });

    // Large compact-mode exports (many employees flattened into one request)
    // can produce a multi-megabyte JSON body — Vercel rejects requests over
    // ~4.5MB at the platform level, BEFORE the route handler even runs (that
    // shows up as a generic host error page, not our own JSON error).
    // Gzip-compressing the body client-side (this JSON is highly repetitive
    // — the same column names over and over — so it compresses very well,
    // often 5-10x) keeps large exports under that limit. Falls back to
    // sending the plain JSON if the browser/webview doesn't support
    // CompressionStream.
    let body: BodyInit = payload;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (typeof CompressionStream !== "undefined") {
      try {
        const stream = new Blob([payload]).stream().pipeThrough(new CompressionStream("gzip"));
        body = await new Response(stream).blob();
        headers["Content-Encoding"] = "gzip";
      } catch {
        body = payload;
      }
    }

    const response = await fetch("/api/export-pdfs", {
      method: "POST",
      headers,
      body
    });

    if (!response.ok) {
      let msg = `Export failed (HTTP ${response.status})`;
      try {
        // Read as text first (always works), then try to parse it as our
        // own JSON error shape. If it ISN'T JSON — e.g. Vercel's own
        // platform-level error page (a payload-too-large rejection, a
        // timeout, etc.) rather than something our route handler returned —
        // show that raw text instead of silently swallowing it, so
        // whatever's available reaches the extension's own UI even when
        // there's no practical way to check server logs.
        const bodyText = await response.text();
        try {
          const err = JSON.parse(bodyText);
          if (err?.error) msg = `Export failed: ${err.error}`;
        } catch {
          if (bodyText.trim()) {
            msg = `Export failed (HTTP ${response.status}): ${bodyText.trim().slice(0, 800)}`;
          }
        }
      } catch {
        /* reading the response body itself failed — keep the generic message */
      }
      throw new Error(msg);
    }

    if (truncated) {
      options.onProgress?.("Note: data was capped at 10,000 rows.");
    }

    return response.blob();
  }
}
