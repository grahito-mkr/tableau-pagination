"use client";

import { useEffect, useRef, useState } from "react";
import { TableauClient } from "@/lib/tableauClient";
import { ExportOrchestrator, type ExportOptions } from "@/lib/exportOrchestrator";

type Status = "idle" | "working" | "done" | "error";
type Mode = "computeFromNo" | "field";

export default function ExportPage() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [worksheets, setWorksheets] = useState<string[]>([]);
  const [worksheet, setWorksheet] = useState("");
  const [mode, setMode] = useState<Mode>("field");
  const [numberField, setNumberField] = useState("");
  const [pageField, setPageField] = useState("");
  const [pageSize, setPageSize] = useState(5);
  const [titleBase, setTitleBase] = useState("Report");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Single long-lived client so a worksheet choice made in the picker is
  // still in effect when Export is clicked.
  const clientRef = useRef<TableauClient | null>(null);

  /** Re-read field names for whichever worksheet is currently selected, and
   * re-run the auto-detection of page/row-number fields against it. */
  async function refreshFieldsForCurrentWorksheet(client: TableauClient) {
    const names = await client.getFieldNames();
    setFields(names);
    setWorksheet(client.worksheetName);

    const pageMatch = findPageField(names);
    const noMatch = findInner(names, "no");

    if (pageMatch) {
      setMode("field");
      setPageField(pageMatch);
    } else if (noMatch) {
      setMode("computeFromNo");
      setNumberField(noMatch);
    } else if (names.length > 0) {
      setMode("field");
      setPageField(names[0]);
      setNumberField(names[0]);
    } else {
      setPageField("");
      setNumberField("");
    }
  }

  function initTableau() {
    if (!(window as any).tableau) return;
    const client = new TableauClient();
    clientRef.current = client;
    client
      .initialize()
      .then(async () => {
        setReady(true);
        setWorksheets(client.getWorksheetNames());
        try {
          await refreshFieldsForCurrentWorksheet(client);
        } catch {
          /* best effort */
        }
      })
      .catch((err: any) => setInitError(err?.message || String(err)));
  }

  async function handleWorksheetChange(name: string) {
    const client = clientRef.current;
    if (!client) return;
    client.selectWorksheet(name);
    setWorksheet(name);
    try {
      await refreshFieldsForCurrentWorksheet(client);
    } catch {
      /* best effort */
    }
  }

  /** Inner name inside an aggregation wrapper, e.g. "AGG(Page)" -> "page". */
  function innerName(n: string): string {
    const m = n.match(/\(([^)]+)\)\s*$/);
    return (m ? m[1] : n).trim().toLowerCase();
  }

  /** Find a field whose inner name equals target exactly. */
  function findInner(names: string[], target: string): string | undefined {
    return names.find((n) => innerName(n) === target);
  }

  /**
   * Find the best "page" field. Matches "page" or "page number" (but not
   * "page size"), tolerating the AGG(...) wrapper.
   */
  function findPageField(names: string[]): string | undefined {
    const isPage = (n: string) => {
      const inner = innerName(n);
      return inner === "page" || inner === "page number" || inner === "pagenumber";
    };
    return names.find(isPage);
  }

  useEffect(() => {
    if ((window as any).tableau) {
      initTableau();
      return;
    }
    const interval = setInterval(() => {
      if ((window as any).tableau) {
        initTableau();
        clearInterval(interval);
      }
    }, 200);
    const giveUp = setTimeout(() => {
      clearInterval(interval);
      if (!(window as any).tableau) {
        setInitError(
          "window.tableau is not available. Open this inside a Tableau dashboard, and make sure /tableau-extensions.min.js is served."
        );
      }
    }, 10000);
    return () => {
      clearInterval(interval);
      clearTimeout(giveUp);
    };
  }, []);

  async function handleExport() {
    if (!ready || status === "working") return;
    setStatus("working");
    setError(null);
    setMessage("Starting...");

    try {
      let client = clientRef.current;
      if (!client) {
        client = new TableauClient();
        await client.initialize();
        clientRef.current = client;
      }
      if (worksheet) client.selectWorksheet(worksheet);
      const orchestrator = new ExportOrchestrator(client);

      const opts: ExportOptions = {
        mode,
        titleBase,
        pageField: mode === "field" ? pageField : undefined,
        numberField: mode === "computeFromNo" ? numberField : undefined,
        pageSize: mode === "computeFromNo" ? pageSize : undefined,
        onProgress: (m) => setMessage(m)
      };

      const blob = await orchestrator.export(opts);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("done");
      setMessage("Export complete.");
    } catch (err: any) {
      setError(err?.message || "Export failed");
      setStatus("error");
    }
  }

  const busy = status === "working";
  const inputStyle = {
    width: "100%",
    padding: 8,
    borderRadius: 6,
    border: "1px solid #ccc",
    boxSizing: "border-box" as const,
    marginBottom: 4
  };

  return (
    <div style={{ padding: 32, maxWidth: 560, margin: "0 auto", fontSize: 14 }}>
      <h1 style={{ fontSize: 22 }}>Tableau Pagination</h1>

      {initError && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 12, marginBottom: 16 }}>
          <strong style={{ color: "crimson" }}>Initialization Error:</strong>
          <pre style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", color: "#555" }}>{initError}</pre>
        </div>
      )}

      {!ready && !initError && <div style={{ color: "#666" }}>Connecting to Tableau...</div>}

      {ready && (
        <>
          <div
            style={{
              background: "#f0f7ff",
              border: "1px solid #cfe0ff",
              borderRadius: 6,
              padding: 12,
              marginBottom: 20,
              fontSize: 13,
              color: "#234"
            }}
          >
            Before exporting, set the dashboard's <strong>Page</strong> control to <strong>(All)</strong> so
            every page's rows are included. Your date and channel filters are left untouched.
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Worksheet</label>
          <select
            value={worksheet}
            onChange={(e) => handleWorksheetChange(e.target.value)}
            style={inputStyle}
          >
            {worksheets.length === 0 && <option value="">No worksheets found</option>}
            {worksheets.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
            The worksheet the extension reads columns from. Pick the one that has{" "}
            <strong>every column you want in the PDF</strong> on its Marks card (Rows/Columns/Detail) —
            not just the page or row-number field. If a field you expect is missing below, this is usually
            the wrong worksheet.
          </div>

          <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How are pages defined?</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={inputStyle}>
            <option value="field">Use an existing Page column (recommended)</option>
            <option value="computeFromNo">Compute from row number (No)</option>
          </select>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
            Recommended: expose the dashboard's own page calc on the worksheet (drag it onto Marks →
            Detail) and select it here — it works on any dashboard regardless of its page formula. Only
            use "Compute from row number" if no page field is available.
          </div>

          {mode === "computeFromNo" ? (
            <>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Row Number Field</label>
              <select value={numberField} onChange={(e) => setNumberField(e.target.value)} style={inputStyle}>
                {fields.length === 0 && <option value="">No fields found</option>}
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
                The field with the row number (usually <code>AGG(No)</code>).
              </div>

              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Page Size</label>
              <input
                type="number"
                min={1}
                value={pageSize}
                onChange={(e) => setPageSize(Math.max(1, parseInt(e.target.value || "1", 10)))}
                style={inputStyle}
              />
              <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
                Rows per page — must match the dashboard's Page Size. Page = <code>INT((No − 1) / Page Size) + 1</code>.
              </div>
            </>
          ) : (
            <>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>Page Field</label>
              <select value={pageField} onChange={(e) => setPageField(e.target.value)} style={inputStyle}>
                {fields.length === 0 && <option value="">No fields found</option>}
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
                The field that holds the page number (one PDF per distinct value). Uses the dashboard's own
                formula, so it adapts automatically if the Page Size parameter changes.
              </div>
            </>
          )}

          <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>PDF Title</label>
          <input value={titleBase} onChange={(e) => setTitleBase(e.target.value)} style={inputStyle} />
          <div style={{ fontSize: 12, color: "#666", marginBottom: 20 }}>
            Base title for each PDF (the page number is appended).
          </div>

          {error && (
            <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 12, marginBottom: 16, color: "crimson" }}>
              {error}
            </div>
          )}

          {status !== "idle" && !error && (
            <div style={{ background: "#f5f5f5", borderRadius: 6, padding: 12, marginBottom: 16 }}>
              {status === "done" ? "✅ " : ""}
              {message}
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={busy}
            style={{
              width: "100%",
              padding: 12,
              fontSize: 15,
              fontWeight: 700,
              color: "#fff",
              background: busy ? "#9bb8e8" : "#2563eb",
              border: "none",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Exporting..." : "Export All Pages as ZIP"}
          </button>
        </>
      )}
    </div>
  );
}
