/**
 * Per-dashboard configuration, keyed by Tableau dashboard NAME.
 *
 * This is the single place that decides what happens when someone clicks
 * Export on a given dashboard — which worksheet to read, how many rows per
 * page, the PDF title, and any static letterhead text. End users never see
 * or edit any of this; the UI is just an Export button.
 *
 * To add a new dashboard:
 *  1. Open the extension on that dashboard once. If its name isn't a key in
 *     this file yet, the panel shows you the exact dashboard name to use and
 *     the list of worksheet names on it.
 *  2. Add an entry below using that dashboard name as the key.
 *  3. Redeploy.
 *
 * Single-report deployments: if only ONE entry exists here, the extension
 * uses it automatically even if the name doesn't match — so the button just
 * works without any name lookup.
 */

export interface DashboardConfig {
  /** Exact worksheet name (as shown in Tableau) to read every column from.
   * Pick the one that has every field you want in the PDF on its Marks card
   * (Rows/Columns/Detail) — not just a page or row-number field. */
  worksheetName: string;
  /** Inner field name (case-insensitive, without any AGG(...) wrapper) that
   * holds the row number used for pagination. Defaults to "no" — override
   * only if this dashboard's row-number field is named something else. */
  numberFieldMatch?: string;
  /** Rows per page — must match the dashboard's own Page Size (parameter or
   * fixed value) so the PDF's page boundaries line up with the dashboard's. */
  pageSize: number;
  /** Base title used for each page's on-page heading in the PDF, e.g.
   * "Report" -> "Report - Page 3". */
  titleBase: string;
  /** Optional static letterhead (company name, report title) centered at the
   * top of every page, above the auto-resolved "Period X to Y" line (read
   * from this dashboard's Start Date/End Date parameters, if present). */
  headerLines?: [string, string];
}

export const DASHBOARD_CONFIGS: Record<string, DashboardConfig> = {
  // Double Tree by Hilton Jakarta Bintaro Raya — Salary report.
  "Salary Report (3)": {
    worksheetName: "Salary Report Pagination",
    pageSize: 5,
    titleBase: "Report",
    headerLines: ["DOUBLE TREE BY HILTON JAKARTA BINTARO RAYA", "REPORT SALARY CRYSTAL REPORT"]
  }

  // Add additional dashboards here, e.g.:
  // "Leads Dashboard": {
  //   worksheetName: "Leads with Details",
  //   pageSize: 5,
  //   titleBase: "Leads Report",
  //   headerLines: ["YOUR COMPANY", "LEADS REPORT"]
  // }
};
