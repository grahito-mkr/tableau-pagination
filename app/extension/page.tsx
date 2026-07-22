"use client";

import { useEffect, useState } from "react";
import { TableauClient } from "@/lib/tableauClient";
import { ExportOrchestrator, type ExportOptions } from "@/lib/exportOrchestrator";

type ExportStatus = "idle" | "detecting" | "exporting" | "done" | "error";

export default function ExportPage() {
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ExportStatus>("idle");
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pageFilterName, setPageFilterName] = useState("Page");
  const [pageCountField, setPageCountField] = useState("No");
  const [titleField, setTitleField] = useState("Report");
  const [filterNames, setFilterNames] = useState<string[]>([]);
  const [initError, setInitError] = useState<string | null>(null);

  /**
   * Initialize Tableau Extensions.
   * The SDK is loaded as a blocking <script> in the layout <head>, so
   * window.tableau should already exist by the time this runs.
   */
  function initTableau() {
    if (!window.tableau) return;

    try {
      const client = new TableauClient();
      client
        .initialize()
        .then(async () => {
          setReady(true);
          const names = await client.getFilterNames();
          setFilterNames(names);
        })
        .catch((err: any) => {
          // initializeAsync itself rejected (e.g. not running inside Tableau)
          setInitError(err?.message || String(err));
        });
    } catch (err: any) {
      setInitError(err?.message || String(err));
    }
  }

  useEffect(() => {
    // SDK should be present immediately (loaded in <head>). Poll briefly as a
    // safety net in case of unusual load ordering inside the Tableau iframe.
    if (window.tableau) {
      initTableau();
      return;
    }

    const interval = setInterval(() => {
      if (window.tableau) {
        initTableau();
        clearInterval(interval);
      }
    }, 200);

    const giveUp = setTimeout(() => {
      clearInterval(interval);
      if (!window.tableau) {
        setInitError(
          "window.tableau is not available. The extension must be opened inside a Tableau dashboard, and /tableau-extensions.min.js must be served correctly."
        );
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      clearTimeout(giveUp);
    };
  }, []);

  /**
   * Handle export button click
   */
  async function handleExport() {
    if (!ready || status !== "idle") return;

    setStatus("detecting");
    setError(null);

    try {
      const client = new TableauClient();
      await client.initialize();

      const orchestrator = new ExportOrchestrator(client);

      const options: ExportOptions = {
        pageFilterName,
        pageCountField,
        titleField,
        maxRecordsPerPage: 100,
        onProgress: (curr, total) => {
          setProgress({ current: curr, total });
          setStatus(curr === 0 ? "detecting" : "exporting");
        }
      };

      const zipBlob = await orchestrator.exportAllPages(options);

      // Trigger download
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("done");
    } catch (err: any) {
      setError(err?.message || "Export failed");
      setStatus("error");
    }
  }

  return (
    <>
      <div style={{ padding: 40, maxWidth: 600, margin: "0 auto" }}>
        <h1>Tableau Pagination</h1>

        {initError && (
          <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 4, padding: 12, marginBottom: 20 }}>
            <strong style={{ color: "crimson" }}>Initialization Error:</strong>
            <pre style={{ marginTop: 8, fontSize: 12, whiteSpace: "pre-wrap", color: "#666" }}>
              {initError}
            </pre>
          </div>
        )}

        {!ready && !initError && (
          <div style={{ color: "#666" }}>Connecting to Tableau...</div>
        )}

        {ready && (
          <form onSubmit={(e) => { e.preventDefault(); handleExport(); }}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
                Page Filter Name
              </label>
              <select
                value={pageFilterName}
                onChange={(e) => setPageFilterName(e.target.value)}
                style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4 }}
              >
                {filterNames.length === 0 ? (
                  <option>No filters found</option>
                ) : (
                  filterNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))
                )}
              </select>
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                The filter that controls pagination (e.g., "Page", "Employee ID")
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
                Page Count Field Name
              </label>
              <input
                type="text"
                value={pageCountField}
                onChange={(e) => setPageCountField(e.target.value)}
                placeholder="e.g., 'No', 'Employee ID'"
                style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                Field that uniquely identifies each page (used to count total pages)
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 4, fontWeight: "bold" }}>
                PDF Title Field
              </label>
              <input
                type="text"
                value={titleField}
                onChange={(e) => setTitleField(e.target.value)}
                placeholder="e.g., 'Employee Report'"
                style={{ width: "100%", padding: 8, border: "1px solid #ccc", borderRadius: 4, boxSizing: "border-box" }}
              />
              <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                Base title for each PDF (page number appended)
              </div>
            </div>

            {error && (
              <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 4, padding: 12, marginBottom: 16, color: "crimson" }}>
                {error}
              </div>
            )}

            {status !== "idle" && (
              <div style={{ marginBottom: 16, padding: 12, background: "#f0f7ff", borderRadius: 4 }}>
                <div style={{ fontWeight: "bold", marginBottom: 8 }}>
                  {status === "detecting" && "🔍 Detecting pages..."}
                  {status === "exporting" && "📄 Generating PDFs..."}
                  {status === "done" && "✅ Export complete!"}
                  {status === "error" && "❌ Export failed"}
                </div>
                {progress.total > 0 && (
                  <div>
                    <div style={{ fontSize: 12, marginBottom: 4 }}>
                      Page {progress.current} of {progress.total}
                    </div>
                    <div style={{ height: 6, background: "#ddd", borderRadius: 3, overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          background: "#2563eb",
                          width: `${(progress.current / progress.total) * 100}%`,
                          transition: "width 0.3s"
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              disabled={status !== "idle" || !ready}
              style={{
                width: "100%",
                padding: 12,
                fontSize: 16,
                fontWeight: "bold",
                background: status !== "idle" || !ready ? "#ccc" : "#2563eb",
                color: "#fff",
                border: "none",
                borderRadius: 4,
                cursor: status !== "idle" || !ready ? "not-allowed" : "pointer"
              }}
            >
              {status === "idle" ? "Export All Pages as ZIP" : "Exporting..."}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
