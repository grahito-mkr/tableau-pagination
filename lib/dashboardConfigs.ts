/**
 * Per-dashboard configuration, keyed by Tableau dashboard NAME.
 *
 * This is the single place that decides what happens when someone clicks
 * Export on a given dashboard — which worksheet to read, how pages are
 * determined, the PDF title, the letterhead, AND the PDF column layout. End
 * users never see or edit any of this; the UI is just an Export button.
 *
 * To add a new dashboard:
 *  1. Open the extension on that dashboard once. If its name isn't a key in
 *     this file yet, the panel shows you the exact dashboard name to use and
 *     the list of worksheet names on it.
 *  2. Add an entry below using that dashboard name as the key.
 *  3. Choose how it paginates (see `mode`), add an optional `columns` layout,
 *     and redeploy. You never need to touch the API route or the orchestrator.
 *
 * Single-report deployments: if only ONE entry exists here, the extension
 * uses it automatically even if the name doesn't match.
 */

export interface ColumnSpec {
  /** Header text shown in the PDF for this column. */
  label: string;
  /** Cleaned inner field names (case-insensitive, without any AGG(...)
   * wrapper) that should map to this column. List every alias that can stand
   * in for it — e.g. a pivoted measure arrives as "Measure Names" /
   * "Measure Values". First match wins. */
  match: string[];
  /** Optional width weight override. Bigger = wider column. */
  width?: number;
}

export interface DashboardConfig {
  /** Exact worksheet name (as shown in Tableau) to read every column from. */
  worksheetName: string;

  /** How pages are determined:
   *  - "computeFromNo" (default): derive the page from a row-number field via
   *    page = INT((No - 1) / pageSize) + 1. Needs `pageSize` to match the
   *    dashboard. Use when the worksheet has NO Page column of its own.
   *  - "field": group by an existing Page column on the worksheet. Preferred
   *    when the dashboard already computes its own Page (e.g. a "Page" calc) —
   *    the PDF's pages then match the dashboard exactly, no pageSize needed. */
  mode?: "computeFromNo" | "field";

  /** mode "computeFromNo": inner name of the row-number field (default "no"). */
  numberFieldMatch?: string;
  /** mode "computeFromNo": rows per page. Must match the dashboard's Page Size
   * so the PDF's page boundaries line up. Ignored in mode "field". */
  pageSize?: number;

  /** mode "field": inner name of the existing Page column (default "page"). */
  pageFieldMatch?: string;

  /** Base title used for each page's on-page heading, e.g. "Report" ->
   * "Report - Page 3". */
  titleBase: string;
  /** Optional static letterhead (company name, report title) centered at the
   * top of every page, above the auto-resolved "Period X to Y" line. */
  headerLines?: [string, string];
  /** Optional PDF column layout. Omit to render every returned field. */
  columns?: ColumnSpec[];
}

export const DASHBOARD_CONFIGS: Record<string, DashboardConfig> = {
  // Double Tree by Hilton Jakarta Bintaro Raya — Salary report.
  // Worksheet has its own "Page" calc, so we group by it directly.
  "Salary Report (3)": {
    worksheetName: "Salary Report Pagination",
    mode: "field",
    pageFieldMatch: "page",
    titleBase: "Report",
    headerLines: ["DOUBLE TREE BY HILTON JAKARTA BINTARO RAYA", "REPORT SALARY CRYSTAL REPORT"],
    columns: [
      { label: "No", match: ["no"] },
      { label: "Employee ID", match: ["employee id"] },
      { label: "Employee Name", match: ["employee name"], width: 20 },
      { label: "Organization", match: ["organization"], width: 20 },
      { label: "PTKP", match: ["ptkp"] },
      { label: "Employee Tax Status", match: ["employee tax status"] },
      { label: "Join Date", match: ["join date"] },
      { label: "Component", match: ["component", "measure names"], width: 16 },
      { label: "Amount", match: ["amount", "measure values", "total_amount", "total amount"], width: 20 }
    ]
  },

  // Custom Report - BPR Daya Perdana — Leads with Details.
  // This worksheet already has a "Page" calc, so we group by it directly
  // (mode "field") — the PDF's pages match the dashboard exactly.
  "Custom Report - BPR Daya Perdana": {
    worksheetName: "Leads with Details",
    mode: "field",
    pageFieldMatch: "Page",
    titleBase: "Leads Report",
    headerLines: ["BPR DAYA PERDANA", "CUSTOM REPORT - LEADS WITH DETAILS"],
    columns: [
      { label: "No", match: ["no"] },
      { label: "Channel", match: ["channel"] },
      { label: "Omni Channel Contact Link", match: ["omni channel contact link"], width: 45 },
      { label: "CRM Contact Link", match: ["crm contact link"], width: 30 },
      { label: "Contact Name", match: ["contact name"], width: 18 },
      { label: "Nomer Telp/User ID", match: ["nomer telp/user id"], width: 16 },
      { label: "Link Room ID", match: ["link room id"], width: 50 }
    ]
  }
};
