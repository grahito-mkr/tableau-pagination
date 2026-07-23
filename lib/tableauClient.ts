/**
 * Tableau Extensions API client.
 *
 * Key robustness choices (learned the hard way):
 *  - A dashboard can contain several worksheet objects. worksheets[0] is not
 *    guaranteed to be the leads table, so we expose ALL worksheet names and let
 *    the UI/caller choose. We also auto-pick the sheet that actually returns
 *    data.
 *  - getSummaryDataAsync is deprecated and can return empty / fail on sheets
 *    with many rows. We prefer getSummaryDataReaderAsync + getAllPagesAsync
 *    (the supported path) and fall back to getSummaryDataAsync only if the
 *    reader API isn't available (older Tableau).
 *  - Summary data (not underlying) is required so calculated fields like
 *    "No" and "Page" are present.
 *  - We never mutate the user's filters.
 */

export interface DataRow {
  [column: string]: string;
}

interface DataTableShape {
  columns: Array<{ fieldName: string; index: number }>;
  data: any[][];
  totalRowCount?: number;
  isTotalRowCountLimited?: boolean;
}

export class TableauClient {
  private dashboard: any;
  private worksheets: any[] = [];
  private worksheet: any;

  constructor() {
    if (typeof window === "undefined" || !(window as any).tableau) {
      throw new Error("Tableau Extensions API not loaded");
    }
  }

  async initialize(): Promise<void> {
    const tableau = (window as any).tableau;
    await tableau.extensions.initializeAsync();
    this.dashboard = tableau.extensions.dashboardContent.dashboard;
    this.worksheets = this.dashboard.worksheets || [];
    if (this.worksheets.length === 0) {
      throw new Error("No worksheets found in this dashboard.");
    }
    this.worksheet = this.worksheets[0];
  }

  /** Names of every worksheet in the dashboard (for a picker). */
  getWorksheetNames(): string[] {
    return this.worksheets.map((w) => w.name);
  }

  /** Explicitly choose which worksheet to read from, by name. */
  selectWorksheet(name: string): void {
    const match = this.worksheets.find((w) => w.name === name);
    if (match) this.worksheet = match;
  }

  get worksheetName(): string {
    return this.worksheet?.name ?? "";
  }

  /**
   * Read summary data from one worksheet, using the reader API when available.
   * Returns the raw DataTable-shaped object, or null on failure/empty.
   */
  private async readSummary(ws: any): Promise<DataTableShape | null> {
    // Preferred path: reader API (not deprecated, handles large data).
    if (typeof ws.getSummaryDataReaderAsync === "function") {
      let reader: any;
      try {
        reader = await ws.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
        const dataTable = await reader.getAllPagesAsync();
        return dataTable;
      } catch {
        return null;
      } finally {
        if (reader?.releaseAsync) {
          try {
            await reader.releaseAsync();
          } catch {
            /* ignore */
          }
        }
      }
    }

    // Fallback: deprecated direct method (older Tableau).
    try {
      return await ws.getSummaryDataAsync({ maxRows: 0, ignoreSelection: true });
    } catch {
      return null;
    }
  }

  /** Convert a DataTable-shaped object into plain row objects keyed by column. */
  private toRows(dataTable: DataTableShape): { columns: string[]; rows: DataRow[] } {
    const columns = dataTable.columns.map((c) => ({ fieldName: c.fieldName, index: c.index }));
    const rows: DataRow[] = dataTable.data.map((rawRow) => {
      const row: DataRow = {};
      for (const col of columns) {
        const cell = rawRow[col.index];
        row[col.fieldName] =
          cell?.formattedValue ??
          (cell?.value !== undefined && cell?.value !== null ? String(cell.value) : "");
      }
      return row;
    });
    return { columns: columns.map((c) => c.fieldName), rows };
  }

  /**
   * Read rows from the currently-selected worksheet. If it comes back empty,
   * fall back to scanning every worksheet and using the first one that returns
   * data — this handles the case where worksheets[0] isn't the leads table.
   */
  async getRows(): Promise<{ columns: string[]; rows: DataRow[]; truncated: boolean; sheet: string }> {
    if (!this.worksheet) throw new Error("No worksheet initialized");

    // Try the selected sheet first.
    let dataTable = await this.readSummary(this.worksheet);
    let usedSheet = this.worksheet;

    // If empty, scan the others for one that has data.
    if (!dataTable || dataTable.data.length === 0) {
      for (const ws of this.worksheets) {
        if (ws === this.worksheet) continue;
        const dt = await this.readSummary(ws);
        if (dt && dt.data.length > 0) {
          dataTable = dt;
          usedSheet = ws;
          break;
        }
      }
    }

    if (!dataTable || dataTable.data.length === 0) {
      throw new Error(
        "No rows were returned from any worksheet. Check that the dashboard has data for the current filters, and that the extension has 'full data' permission."
      );
    }

    const { columns, rows } = this.toRows(dataTable);
    return {
      columns,
      rows,
      truncated: Boolean(dataTable.isTotalRowCountLimited),
      sheet: usedSheet.name
    };
  }

  /**
   * Field names on the worksheet that actually has data (summary data, so
   * calculated fields like No/Page are included).
   */
  async getFieldNames(): Promise<string[]> {
    // Reuse getRows' sheet-scan so the dropdown reflects the sheet we'll export.
    try {
      const { columns } = await this.getRows();
      return columns;
    } catch {
      return [];
    }
  }

  /**
   * Read the current value of one or more dashboard Parameters (not
   * worksheet fields — e.g. the "Admin & Payroll" / "DOF" / "DOHR" / "GM"
   * dropdowns that drive a signature block). Returns a map of parameter name
   * -> formatted current value. Missing parameters are simply omitted from
   * the result rather than throwing, so a signature block can degrade
   * gracefully instead of failing the whole export.
   */
  async getParameterValues(names: string[]): Promise<Record<string, string>> {
    const tableau = (window as any).tableau;
    if (!tableau) return {};
    try {
      const params = await tableau.extensions.dashboardContent.dashboard.getParametersAsync();
      const wanted = new Set(names.map((n) => n.toLowerCase()));
      const result: Record<string, string> = {};
      for (const p of params) {
        if (wanted.has(String(p.name).toLowerCase())) {
          const v = p.currentValue;
          result[p.name] = v?.formattedValue ?? String(v?.value ?? "");
        }
      }
      return result;
    } catch {
      return {};
    }
  }

  saveState(key: string, state: unknown): void {
    const tableau = (window as any).tableau;
    if (!tableau) return;
    tableau.extensions.settings.set(key, JSON.stringify(state));
    tableau.extensions.settings.saveAsync().catch(() => {});
  }

  loadState<T = unknown>(key: string): T | null {
    const tableau = (window as any).tableau;
    if (!tableau) return null;
    const saved = tableau.extensions.settings.get(key);
    try {
      return saved ? (JSON.parse(saved) as T) : null;
    } catch {
      return null;
    }
  }
}
