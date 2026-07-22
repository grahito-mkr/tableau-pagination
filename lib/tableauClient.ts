/**
 * Tableau Extensions API client
 * Handles dashboard context, filter updates, and data queries via VizQL Data Service
 */

export interface FilterValue {
  value: string | number;
  isRelative?: boolean;
}

export interface DataRow {
  [key: string]: unknown;
}

export class TableauClient {
  private dashboard: any;
  private worksheet: any;

  constructor() {
    if (!window.tableau) {
      throw new Error("Tableau Extensions API not loaded");
    }
  }

  /**
   * Initialize Tableau Extensions
   */
  async initialize(): Promise<void> {
    await window.tableau.extensions.initializeAsync();
    this.dashboard = window.tableau.extensions.dashboardContent.dashboard;
    this.worksheet = this.dashboard.worksheets[0];
    if (!this.worksheet) {
      throw new Error("No worksheets found in dashboard");
    }
  }

  /**
   * Get all worksheets
   */
  getWorksheets() {
    return this.dashboard.worksheets;
  }

  /**
   * Get data from worksheet (respects current filters)
   */
  async getUnderlyingData(maxRows = 10000): Promise<DataRow[]> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    const data = await this.worksheet.getUnderlyingDataAsync({ maxRows });
    return data.data as DataRow[];
  }

  /**
   * Get summary data (aggregated, faster)
   */
  async getSummaryData(maxRows = 1000): Promise<DataRow[]> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    const data = await this.worksheet.getSummaryDataAsync({ maxRows });
    return data.data as DataRow[];
  }

  /**
   * Apply filter to worksheet (page/pagination filter).
   * applyFilterAsync requires the values as an array, even for a single value.
   */
  async applyFilter(filterName: string, filterValue: string | number): Promise<void> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    await this.worksheet.applyFilterAsync(
      filterName,
      [String(filterValue)],
      window.tableau.FilterUpdateType.Replace
    );
  }

  /**
   * Clear a filter (show all values)
   */
  async clearFilter(filterName: string): Promise<void> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    await this.worksheet.applyFilterAsync(filterName, [], window.tableau.FilterUpdateType.All);
  }

  /**
   * Get all filter names for this worksheet.
   * getFiltersAsync is asynchronous and returns a Promise of Filter objects;
   * each Filter exposes a fieldName.
   */
  async getFilterNames(): Promise<string[]> {
    if (!this.worksheet) return [];
    const filters = await this.worksheet.getFiltersAsync();
    return filters.map((f: any) => f.fieldName);
  }

  /**
   * Save canvas state to Tableau settings (extension storage)
   */
  saveState(key: string, state: unknown): void {
    if (!window.tableau) return;
    window.tableau.extensions.settings.set(key, JSON.stringify(state));
    window.tableau.extensions.settings.saveAsync().catch(console.error);
  }

  /**
   * Load canvas state from Tableau settings
   */
  loadState(key: string): unknown | null {
    if (!window.tableau) return null;
    const saved = window.tableau.extensions.settings.get(key);
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  }
}
