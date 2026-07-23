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

export interface PageData {
  pageNumber: string;
  title: string;
  columns: string[];
  rows: DataRow[];
}

export interface ExportOptions {
  /**
   * How pages are determined:
   *  - "field": group by an existing page column's value (pageField).
   *  - "computeFromNo": there is no Page column in the view, so compute the
   *    page number from the row number field (numberField) using the same
   *    formula the dashboard uses:
   *      Page = if No % 10 == 0 then int(No/5) else int(No/5)+1
   */
  mode: "field" | "computeFromNo";
  /** Column to group by when mode === "field" (e.g. "Page" or "AGG(Page)"). */
  pageField?: string;
  /** Column holding the row number when mode === "computeFromNo" (e.g. "AGG(No)"). */
  numberField?: string;
  /** Base title for each PDF; the page number is appended. */
  titleBase: string;
  onProgress?: (message: string) => void;
}

/** Replicates the dashboard's Page calc exactly. */
function computePage(no: number): number {
  return no % 10 === 0 ? Math.trunc(no / 5) : Math.trunc(no / 5) + 1;
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
    const { mode, pageField, numberField, titleBase, onProgress } = options;

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
        return no == null ? "" : String(computePage(no));
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

    // Sanity guard: the page field should have a small number of distinct
    // values (one per visual page). If it produced hundreds/thousands, the
    // wrong field was selected (e.g. a per-row id like "No"). Stop and explain
    // instead of generating thousands of PDFs.
    const MAX_PAGES = 200;
    if (sortedKeys.length > MAX_PAGES) {
      const sample = sortedKeys.slice(0, 8).join(", ");
      throw new Error(
        `Field "${sourceField}" has ${sortedKeys.length} distinct values, which is too many to be page numbers ` +
          `(sample: ${sample}...). Pick the field that holds the PAGE number ` +
          `(often shown as "AGG(Page)"), not a per-row id like "No".`
      );
    }

    const pages: PageData[] = sortedKeys.map((key) => ({
      pageNumber: key,
      title: `${titleBase} - Page ${key}`,
      columns,
      rows: groups.get(key)!
    }));

    return { pages, truncated };
  }

  /**
   * Full export: build pages, POST to backend, return the ZIP blob.
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
