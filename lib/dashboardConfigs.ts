/**
 * Per-dashboard configuration, keyed by Tableau dashboard NAME.
 *
 * This is the single place that decides what happens when someone clicks
 * Export on a given dashboard — which worksheet to read, how many rows per
 * page, the PDF title, the letterhead, AND the PDF column layout. End users
 * never see or edit any of this; the UI is just an Export button.
 *
 * To add a new dashboard:
 *  1. Open the extension on that dashboard once. If its name isn't a key in
 *     this file yet, the panel shows you the exact dashboard name to use and
 *     the list of worksheet names on it.
 *  2. Add an entry below using that dashboard name as the key.
 *  3. Optionally add a `columns` layout (see ColumnSpec). If you omit it, the
 *     PDF renders every field the worksheet returns, in worksheet order.
 *  4. Redeploy. You never need to touch the API route or the orchestrator.
 *
 * Single-report deployments: if only ONE entry exists here, the extension
 * uses it automatically even if the name doesn't match — so the button just
 * works without any name lookup.
 */

export interface ColumnSpec {
  /** Header text shown in the PDF for this column. */
  label: string;
  /** Cleaned inner field names (case-insensitive, without any AGG(...)
   * wrapper) that should map to this column. List every alias that can stand
   * in for it — e.g. a pivoted measure arrives as "Measure Names" /
   * "Measure Values" rather than its literal name. First match wins. */
  match: string[];
  /** Optional width weight override. Bigger = wider column. Use for formatted
   * currency or long text that needs more room than its label length implies. */
  width?: number;
}

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
  /** Optional PDF column layout: which columns to show, in what order, with
   * what header and width. Omit to render every returned field generically. */
  columns?: ColumnSpec[];
}

export const DASHBOARD_CONFIGS: Record<string, DashboardConfig> = {
  // Double Tree by Hilton Jakarta Bintaro Raya — Salary report.
  "Salary Report (3)": {
    worksheetName: "Salary Report Pagination",
    pageSize: 5,
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
  "Custom Report - BPR Daya Perdana": {
    worksheetName: "Leads with Details",
    pageSize: 5,
    titleBase: "Leads Report",
    numberFieldMatch: "no",
    headerLines: ["BPR DAYA PERDANA", "CUSTOM REPORT - LEADS WITH DETAILS"],
    columns: [
      { label: "No", match: ["no"] },
      { label: "Channel", match: ["channel"] },
      { label: "Omni Channel Contact Link", match: ["omni channel contact link"], width: 45 },
      { label: "CRM Contact Link", match: ["crm contact link"], width: 30 },
      { label: "Contact Name", match: ["contact name"], width: 18 },
      { label: "Nomer Telp/User ID", match: ["nomer telp/user id"], width: 16 },
      { label: "Link Room ID", match: ["link room id"], width: 50 },
      { label: "Tagging Omni Channel", match: ["tagging omni channel"] }
    ]
  }

  // Add additional dashboards here, e.g.:
  // "Leads Dashboard": {
  //   worksheetName: "Leads with Details",
  //   pageSize: 5,
  //   titleBase: "Leads Report",
  //   headerLines: ["YOUR COMPANY", "LEADS REPORT"],
  //   columns: [
  //     { label: "No", match: ["no"] },
  //     { label: "Lead Name", match: ["lead name"], width: 20 },
  //     { label: "Status", match: ["status"] },
  //     { label: "Value", match: ["value", "measure values"], width: 16 }
  //   ]
  //   // Omit `columns` entirely to just render every field the worksheet returns.
  // }
};
