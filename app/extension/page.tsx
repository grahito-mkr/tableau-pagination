"use client";

import { useEffect, useState } from "react";
import { TableauClient } from "@/lib/tableauClient";
import { ExportOrchestrator, type ExportOptions } from "@/lib/exportOrchestrator";

type Status = "idle" | "working" | "done" | "error";
type Mode = "computeFromNo" | "field";

export default function ExportPage() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [fields, setFields] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("computeFromNo");
  const [numberField, setNumberField] = useState("");
  const [pageField, setPageField] = useState("");
  const [titleBase, setTitleBase] = useState("Report");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  function initTableau() {
    if (!(window as any).tableau) return;
    const client = new TableauClient();
    client
      .initialize()
      .then(async () => {
        setReady(true);
        try {
          const names = await client.getFieldNames();
          setFields(names);

          // Prefer an explicit page field if one is actually on the view.
          const pageMatch = findInner(names, "page");
          const noMatch = findInner(names, "no");

          if (pageMatch) {
            setMode("field");
            setPageField(pageMatch);
          } else if (noMatch) {
            // No Page column in the view (common): compute it from No.
            setMode("computeFromNo");
            setNumberField(noMatch);
          } else if (names.length > 0) {
            setMode("field");
            setPageField(names[0]);
          }
        } catch {
          /* best effort */
        }
      })
      .catch((err: any) => setInitError(err?.message || String(err)));
  }

  /** Find a field whose inner name (inside AGG(...) etc.) equals target. */
  function findInner(names: string[], target: string): string | undefined {
    const inner = (n: string) => {
      const m = n.match(/\(([^)]+)\)\s*$/);
      return (m ? m[1] : n).trim().toLowerCase();
    };
    return names.find((n) => inner(n) === target);
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
      const client = new TableauClient();
      await client.initialize();
      const orchestrator = new ExportOrchestrator(client);

      const opts: ExportOptions = {
        mode,
        titleBase,
        pageField: mode === "field" ? pageField : undefined,
        numberField: mode === "computeFromNo" ? numberField : undefined,
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

          <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>How are pages defined?</label>
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} style={inputStyle}>
            <option value="computeFromNo">Compute from row number (No)</option>
            <option value="field">Use an existing Page column</option>
          </select>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
            Your dashboard computes Page as <code>ceil(No / 5)</code>; the Page column isn't in the data
            feed, so the row-number option is the reliable choice.
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
                The field with the lead number (usually <code>AGG(No)</code>). Page = ceil(No / 5).
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
                The field that holds the page number (one PDF per distinct value).
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
