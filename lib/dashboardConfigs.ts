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
  /** When true (the default), this cell is blanked whenever its value
   * repeats the row directly above it within the same "No" group — mimics
   * Tableau's merged cells for a per-employee dimension (Employee Name,
   * Organization, ...). Set to `false` for per-line-item columns like
   * "Component"/"Amount", where two different rows can legitimately share
   * the same value (e.g. two components with an identical amount) — those
   * must always be shown, never blanked as if they were "the same as
   * above". */
  group?: boolean;
}

export interface RowSortSpec {
  /** Alias list (same matching rule as ColumnSpec.match) identifying the
   * field to sort by first, using a manual priority order — e.g. a
   * "tax_mode" helper calc with values like Basic Salary / Allowance /
   * Deduction / Benefit / Other. */
  match: string[];
  /** Manual priority order for this field's values (case-insensitive
   * compare). Any value not listed sorts after all listed ones, keeping its
   * original relative order. */
  order: string[];
  /** After the manual order above, break ties by sorting alphabetically on
   * this field (e.g. Component name within the same tax_mode group).
   * Optional — omit to leave ties in their original relative order. */
  thenAlphabetical?: {
    match: string[];
  };
}

export interface LogoSpec {
  /** Path to the image file, relative to the project's `public/` folder
   * (e.g. "/logos/doubletree.png"). Drop the actual image file there
   * yourself — this only points at it. */
  path: string;
  /** Box the logo is scaled to fit inside, preserving aspect ratio (points).
   * Defaults to 70x40 if omitted. */
  maxWidth?: number;
  maxHeight?: number;
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

  /** Optional row ordering applied within each row-number ("No") group before
   * pagination/rendering — e.g. force Component rows into a fixed category
   * order (Basic Salary, Allowance, Deduction, Benefit, Other) and then
   * alphabetize within each category. Rows are always kept grouped by "No"
   * first; this only reorders rows *inside* each "No" group. Omit to keep
   * whatever order the Tableau summary-data query returns. */
  rowSort?: RowSortSpec;

  /** Logo shown top-left of every physical PDF page, next to the "Print
   * date"/"Print by" block on the top-right. Omit to show no logo. */
  logo?: LogoSpec;

  /** Alias list (same matching rule as ColumnSpec.match) identifying the
   * worksheet field holding the current viewer's username (e.g. a
   * USERNAME() calc, like the "User Name" field). Shown top-right as
   * "Print by: <value>". Its value is read from the first exported row
   * (the field is constant per export, not per-row). Omit to hide that
   * line. */
  printedByMatch?: string[];

  /** Alias lists (same matching rule as ColumnSpec.match) identifying the
   * worksheet fields holding the report's period, e.g. "Period Start"/
   * "Period End" columns. Resolved from the first exported row, same as
   * `printedByMatch`. Shown as "Period <start> to <end>" under the
   * letterhead. Takes priority over the Start Date/End Date dashboard
   * Parameter lookup. Omit to use that Parameter lookup instead. */
  periodMatch?: { start: string[]; end: string[] };

  /** When true, ignore Tableau's own Page/No-based pagination entirely and
   * pack "No" groups (e.g. one employee's rows) onto physical PDF pages
   * purely by how much actually fits — 2 employees on one page if that's
   * all that fits, 4 if there's room for 4, etc. Each physical page gets a
   * live "{titleBase} - Page N" title reflecting the TRUE physical page
   * number, instead of Tableau's own (possibly inconsistent once several
   * Tableau pages share one physical sheet) page numbering. Omit/false to
   * keep the classic behavior (one PDF page-group per Tableau Page/No
   * bucket, packed onto shared physical pages only when they fit whole). */
  compactPacking?: boolean;
}

export const DASHBOARD_CONFIGS: Record<string, DashboardConfig> = {
  // Double Tree by Hilton Jakarta Bintaro Raya — Salary report.
  "Salary Report (3)": {
    worksheetName: "Salary Report Pagination",
    pageSize: 2,
    titleBase: "Report",
    headerLines: ["DOUBLE TREE BY HILTON JAKARTA BINTARO RAYA", "REPORT SALARY CRYSTAL REPORT"],
    // Drop the actual logo file at public/logos/doubletree.png (any image
    // format PDFKit supports: PNG/JPEG). It's auto-scaled to fit this box.
    logo: { path: "/logos/doubletree.png", maxWidth: 220, maxHeight: 110 },
    printedByMatch: ["user name", "username"],
    // Pack employees onto physical pages purely by how much fits, instead of
    // Tableau's own fixed Page Size(2)-per-page grouping.
    compactPacking: true,
    // Period Start/Period End are worksheet columns on this report, not
    // dashboard Parameters.
    // "Period Start"/"Period End" are worksheet columns (calculated fields
    // that echo the "Start Month"/"End Month" Parameters); "Start Month"/
    // "End Month" are the underlying Parameter names. These aliases cover
    // both resolution paths — whichever one this worksheet actually exposes.
    periodMatch: { start: [ "start month"], end: ["end month"] },
    columns: [
      { label: "No", match: ["no"] },
      { label: "Employee ID", match: ["employee id"] },
      { label: "Employee Name", match: ["employee name"], width: 20 },
      { label: "Organization", match: ["organization"], width: 20 },
      { label: "PTKP", match: ["ptkp"] },
      { label: "Employee Tax Status", match: ["employee tax status"] },
      { label: "Join Date", match: ["join date"] },
      // group: false — these are per-line-item values, not a per-employee
      // dimension. Two different components can legitimately share the same
      // Component text or the same Amount (e.g. "Full Basic Salary" and
      // "Basic Salary Paid" both being 136.069.742); they must never be
      // blanked as if one were "the same as the row above".
      { label: "Component", match: ["component", "measure names"], width: 18, group: false },
      // Extra width so formatted amounts (thousands separators, decimals)
      // have room before the per-cell auto-shrink font kicks in.
      { label: "Amount", match: ["amount", "measure values", "total_amount", "total amount"], width: 26, group: false }
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
  },

  // Double Tree by Hilton Jakarta Bintaro Raya — Salary report.
  "Salary Crystal Report": {
    worksheetName: "Salary Report Pagination",
    pageSize: 2,
    titleBase: "Report",
    headerLines: ["DOUBLE TREE BY HILTON JAKARTA BINTARO RAYA", "REPORT SALARY CRYSTAL REPORT"],
    logo: { path: "/logos/doubletree.png", maxWidth: 220, maxHeight: 110 },
    printedByMatch: ["User Name", "user name"],
    // Pack employees onto physical pages purely by how much fits, instead of
    // Tableau's own fixed Page Size(2)-per-page grouping.
    compactPacking: true,
    // Period Start/Period End are worksheet columns on this report, not
    // dashboard Parameters.
    // "Period Start"/"Period End" are worksheet columns (calculated fields
    // that echo the "Start Month"/"End Month" Parameters); "Start Month"/
    // "End Month" are the underlying Parameter names. These aliases cover
    // both resolution paths — whichever one this worksheet actually exposes.
    periodMatch: { start: ["period start", "start month"], end: ["period end", "end month"] },
    columns: [
      { label: "No", match: ["no"] },
      { label: "Employee ID", match: ["employee id"] },
      { label: "Employee Name", match: ["employee name"], width: 20 },
      { label: "Organization", match: ["organization"], width: 20 },
      { label: "PTKP", match: ["ptkp"] },
      { label: "Employee Tax Status", match: ["employee tax status"] },
      { label: "Join Date", match: ["join date"] },
      // group: false — these are per-line-item values, not a per-employee
      // dimension. Two different components can legitimately share the same
      // Component text or the same Amount (e.g. "Full Basic Salary" and
      // "Basic Salary Paid" both being 136.069.742); they must never be
      // blanked as if one were "the same as the row above".
      { label: "Component", match: ["component", "measure names"], width: 18, group: false },
      // Extra width so formatted amounts (thousands separators, decimals)
      // have room before the per-cell auto-shrink font kicks in.
      { label: "Amount", match: ["amount", "measure values", "total_amount", "total amount"], width: 26, group: false }
    ],
    // Per employee (each "No" group), force Component rows into this fixed
    // category order, then alphabetize Component names within each category.
    rowSort: {
      match: ["Tax Mode", "tax mode"],
      order: [
        "Full Basic Salary",
        "Basic Salary Paid",
        "allowance",
        "deduction",
        "benefit",
        "loan",
        "pph bonus",
        "jkk",
        "jkm",
        "jht company",
        "jp company",
        "bpjsk company",
        "total allowances salary detail",
        "total deduction salary detail",
        "take home pay",
        "gross monthly",
        "Working Days",
        "Leave"
      ],
      thenAlphabetical: { match: ["component", "measure names"] }
    }
  },

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