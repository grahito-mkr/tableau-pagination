/**
 * Tableau Extensions API client.
 *
 * Responsibilities:
 *  - initialize the extension and grab the first worksheet
 *  - read the full underlying data table and convert it into plain row objects
 *    keyed by column name, using each cell's formattedValue (the display string)
 *  - list available field/column names so the UI can offer a dropdown
 *
 * Deliberately does NOT mutate the user's date/channel filters. The only
 * filter it will touch is the pagination filter, and only via the
 * save/restore helpers below, so the dashboard is left exactly as it was.
 */

export interface DataRow {
  [column: string]: string;
}

export class TableauClient {
  private dashboard: any;
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
    this.worksheet = this.dashboard.worksheets[0];
    if (!this.worksheet) {
      throw new Error("No worksheets found in this dashboard.");
    }
  }

  /** Human-readable worksheet name (for messages). */
  get worksheetName(): string {
    return this.worksheet?.name ?? "";
  }

  /**
   * Read the worksheet's summary data and return plain row objects keyed by
   * column name. Each value is the cell's formattedValue (what the user sees).
   *
   * We use SUMMARY data (not underlying) because the worksheet's calculated
   * fields — including "No" and "Page" — only exist in the summary/view data.
   * Underlying data returns only the raw source columns and omits calcs.
   * Summary data is also not capped at 10,000 rows.
   */
  async getRows(): Promise<{ columns: string[]; rows: DataRow[]; truncated: boolean }> {
    if (!this.worksheet) throw new Error("No worksheet initialized");

    const dataTable = await this.worksheet.getSummaryDataAsync({
      maxRows: 0,
      ignoreSelection: true
    });

    const columns: Array<{ fieldName: string; index: number }> = dataTable.columns.map(
      (c: any) => ({ fieldName: c.fieldName, index: c.index })
    );

    const rows: DataRow[] = dataTable.data.map((rawRow: any[]) => {
      const row: DataRow = {};
      for (const col of columns) {
        const cell = rawRow[col.index];
        // formattedValue is the display string; fall back to value if absent.
        const display =
          cell?.formattedValue ??
          (cell?.value !== undefined && cell?.value !== null ? String(cell.value) : "");
        row[col.fieldName] = display;
      }
      return row;
    });

    return {
      columns: columns.map((c) => c.fieldName),
      rows,
      truncated: Boolean(dataTable.isTotalRowCountLimited)
    };
  }

  /**
   * List the field names on the worksheet, so the UI can show a dropdown
   * instead of the user typing a guess. Uses summary data so calculated fields
   * (No, Page, etc.) are included.
   */
  async getFieldNames(): Promise<string[]> {
    if (!this.worksheet) return [];
    const dataTable = await this.worksheet.getSummaryDataAsync({ maxRows: 1, ignoreSelection: true });
    return dataTable.columns.map((c: any) => c.fieldName);
  }

  /** Persist small bits of config in the extension's settings store. */
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
