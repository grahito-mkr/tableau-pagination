"use client";

import { useEffect, useRef, useState } from "react";
import { TableauClient } from "@/lib/tableauClient";
import { ExportOrchestrator, type ExportOptions } from "@/lib/exportOrchestrator";
import { DASHBOARD_CONFIGS, type DashboardConfig } from "@/lib/dashboardConfigs";

type Status = "idle" | "working" | "done" | "error";

/** Inner name inside an aggregation wrapper, e.g. "AGG(No)" -> "no". */
function innerName(n: string): string {
  const m = n.match(/\(([^)]+)\)\s*$/);
  return (m ? m[1] : n).trim().toLowerCase();
}

/** Find a field whose inner name equals target exactly (case-insensitive). */
function findInner(names: string[], target: string): string | undefined {
  return names.find((n) => innerName(n) === target.toLowerCase());
}

export default function ExportPage() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState("");
  const [worksheetNames, setWorksheetNames] = useState<string[]>([]);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [numberField, setNumberField] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Single long-lived client so everything set up during init is still in
  // effect when Export is clicked.
  const clientRef = useRef<TableauClient | null>(null);

  function initTableau() {
    if (!(window as any).tableau) return;
    const client = new TableauClient();
    clientRef.current = client;
    client
      .initialize()
      .then(async () => {
        setReady(true);

        const id = client.dashboardName;
        setDashboardId(id);
        setWorksheetNames(client.getWorksheetNames());

        // Resolve config by dashboard name. If it doesn't match but exactly
        // one config is defined (the common single-report deployment), just
        // use it — the end user only ever clicks Export.
        let cfg = DASHBOARD_CONFIGS[id];
        if (!cfg) {
          const all = Object.values(DASHBOARD_CONFIGS);
          if (all.length === 1) cfg = all[0];
        }
        setConfig(cfg ?? null);
        if (!cfg) return;

        client.selectWorksheet(cfg.worksheetName);
        try {
          const names = await client.getFieldNames();
          const match = findInner(names, cfg.numberFieldMatch ?? "no");
          if (!match) {
            setConfigError(
              `Configured worksheet "${cfg.worksheetName}" has no field matching ` +
                `"${cfg.numberFieldMatch ?? "no"}". Available fields: ${names.join(", ") || "(none)"}.`
            );
            return;
          }
          setNumberField(match);
        } catch (err: any) {
          setConfigError(err?.message || "Could not read fields from the configured worksheet.");
        }
      })
      .catch((err: any) => setInitError(err?.message || String(err)));
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
    if (!ready || status === "working" || !config || !numberField) return;
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
      client.selectWorksheet(config.worksheetName);

      const orchestrator = new ExportOrchestrator(client);

      const opts: ExportOptions = {
        mode: "computeFromNo",
        titleBase: config.titleBase,
        headerLines: config.headerLines ? [...config.headerLines] : undefined,
        columnLayout: config.columns,
        numberField,
        pageSize: config.pageSize,
        onProgress: (m) => setMessage(m)
      };

      const blob = await orchestrator.export(opts);

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export-${new Date().toISOString().slice(0, 10)}.pdf`;
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

  return (
    <div style={{ padding: 32, maxWidth: 420, margin: "0 auto", fontSize: 14, textAlign: "center" }}>
      {initError && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 12, marginBottom: 16, textAlign: "left" }}>
          <strong style={{ color: "crimson" }}>Initialization Error:</strong>
          <pre style={{ marginTop: 6, fontSize: 12, whiteSpace: "pre-wrap", color: "#555" }}>{initError}</pre>
        </div>
      )}

      {!ready && !initError && <div style={{ color: "#666" }}>Connecting to Tableau...</div>}

      {ready && !config && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 16, textAlign: "left", fontSize: 13 }}>
          <strong style={{ color: "crimson" }}>This dashboard isn't configured yet.</strong>
          <p style={{ marginTop: 8, marginBottom: 4 }}>
            Add an entry to <code>lib/dashboardConfigs.ts</code> using this dashboard name as the key:
          </p>
          <pre style={{ background: "#fff", padding: 8, borderRadius: 4, overflowX: "auto", border: "1px solid #eee" }}>
            {dashboardId || "(empty — check console)"}
          </pre>
          <p style={{ marginTop: 8, marginBottom: 4 }}>Worksheets on this dashboard:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {worksheetNames.map((w) => (
              <li key={w}>
                <code>{w}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && config && configError && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 12, marginBottom: 16, textAlign: "left", color: "crimson", fontSize: 13 }}>
          {configError}
        </div>
      )}

      {ready && config && !configError && (
        <>
          {error && (
            <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 12, marginBottom: 16, color: "crimson", textAlign: "left" }}>
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
              padding: 16,
              fontSize: 16,
              fontWeight: 700,
              color: "#fff",
              background: busy ? "#9bb8e8" : "#2563eb",
              border: "none",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Exporting..." : "Export"}
          </button>
        </>
      )}
    </div>
  );
}
