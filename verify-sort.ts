import { ExportOrchestrator } from "./lib/exportOrchestrator";
import { TableauClient, type DataRow } from "./lib/tableauClient";
import { DASHBOARD_CONFIGS } from "./lib/dashboardConfigs";

const columns = ["No", "Employee Name", "Tax Mode", "Component"];
const rows: DataRow[] = [
  { "No": "1", "Employee Name": "Alice", "Tax Mode": "jkk", "Component": "JKK" },
  { "No": "1", "Employee Name": "Alice", "Tax Mode": "allowance", "Component": "Transport" },
  { "No": "1", "Employee Name": "Alice", "Tax Mode": "Full Basic Salary", "Component": "Base Pay" },
  { "No": "1", "Employee Name": "Alice", "Tax Mode": "allowance", "Component": "Meal" },
];

class FakeClient {
  async getRows() { return { columns, rows, truncated: false, sheet: "x" }; }
  async getParameterValues() { return {}; }
}

(async () => {
  const cfg = DASHBOARD_CONFIGS["Custom Report - Double Tree Hilton Bintaro"];
  console.log("rowSort loaded:", JSON.stringify(cfg?.rowSort?.match), JSON.stringify(cfg?.rowSort?.thenAlphabetical));
  const orch = new ExportOrchestrator(new FakeClient() as unknown as TableauClient);
  const { pages } = await orch.buildPages({ mode: "field", pageField: "No", titleBase: cfg.titleBase, rowSort: cfg.rowSort } as any);
  for (const p of pages) for (const r of p.rows) console.log(r["Tax Mode"], "->", r["Component"]);
})();