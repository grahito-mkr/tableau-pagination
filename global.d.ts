/**
 * Tableau Extensions API global type definitions
 */

declare global {
  interface Window {
    tableau: {
      extensions: {
        initializeAsync(): Promise<void>;
        dashboardContent: {
          dashboard: {
            worksheets: Worksheet[];
          };
        };
        settings: {
          get(key: string): string | null;
          set(key: string, value: string): void;
          saveAsync(): Promise<void>;
        };
      };
      FilterUpdateType: {
        Replace: string;
        Add: string;
        All: string;
      };
    };
  }
}

interface Worksheet {
  name: string;
  getFilters(): Array<{ name: string }>;
  applyFilterAsync(
    filterName: string,
    value: string,
    updateType: string
  ): Promise<void>;
  getUnderlyingDataAsync(options?: { maxRows: number }): Promise<{ data: Array<Record<string, unknown>> }>;
  getSummaryDataAsync(options?: { maxRows: number }): Promise<{ data: Array<Record<string, unknown>> }>;
}

export {};
