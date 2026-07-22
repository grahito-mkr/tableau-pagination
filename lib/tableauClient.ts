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
   * Apply filter to worksheet (page/pagination filter)
   * e.g., filterByPageNumber("Page Number", 1)
   */
  async applyFilter(filterName: string, filterValue: string | number): Promise<void> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    await this.worksheet.applyFilterAsync(filterName, String(filterValue), window.tableau.FilterUpdateType.Replace);
  }

  /**
   * Clear a filter
   */
  async clearFilter(filterName: string): Promise<void> {
    if (!this.worksheet) throw new Error("No worksheet initialized");
    await this.worksheet.applyFilterAsync(filterName, "", window.tableau.FilterUpdateType.All);
  }

  /**
   * Get all filter names for this worksheet
   */
  getFilterNames(): string[] {
    if (!this.worksheet) return [];
    return this.worksheet.getFilters().map((f: any) => f.name);
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
