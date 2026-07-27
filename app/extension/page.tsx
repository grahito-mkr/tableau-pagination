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

/** Strip characters that aren't safe in a downloaded file name on
 * Windows/macOS (\ / : * ? " < > |), collapsing extra whitespace. */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export default function ExportPage() {
  const [ready, setReady] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [dashboardId, setDashboardId] = useState("");
  const [worksheetNames, setWorksheetNames] = useState<string[]>([]);
  const [config, setConfig] = useState<DashboardConfig | null>(null);
  const [resolvedField, setResolvedField] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Diagnostics from the last export (e.g. "Print by"/"Period" field not
  // found) — shown directly in this panel so they're visible even when
  // testing inside Tableau Desktop, where opening the extension's own
  // DevTools console isn't always straightforward.
  const [warnings, setWarnings] = useState<string[]>([]);

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
          const useField = cfg.mode === "field";
          const target = useField
            ? cfg.pageFieldMatch ?? "page"
            : cfg.numberFieldMatch ?? "no";
          const match = findInner(names, target);
          if (!match) {
            setConfigError(
              `Configured worksheet "${cfg.worksheetName}" has no field matching ` +
                `"${target}". Available fields: ${names.join(", ") || "(none)"}.`
            );
            return;
          }
          setResolvedField(match);
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
    if (!ready || status === "working" || !config || !resolvedField) return;
    setStatus("working");
    setError(null);
    setWarnings([]);
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

      const mode = config.mode ?? "computeFromNo";
      const opts: ExportOptions = {
        mode,
        titleBase: config.titleBase,
        headerLines: config.headerLines ? [...config.headerLines] : undefined,
        columnLayout: config.columns,
        rowSort: config.rowSort,
        logo: config.logo,
        printedByMatch: config.printedByMatch,
        periodMatch: config.periodMatch,
        compactPacking: config.compactPacking,
        ...(mode === "field"
          ? { pageField: resolvedField }
          : { numberField: resolvedField, pageSize: config.pageSize }),
        onProgress: (m) => setMessage(m)
      };

      const blob = await orchestrator.export(opts);
      setWarnings(orchestrator.lastWarnings);

      // "[Dashboard Name] Period <start> to <end>.pdf" — falls back to just
      // the dashboard name (or a dated name, if even that's unavailable) if
      // the period couldn't be resolved.
      const namePieces = [dashboardId || "Export", orchestrator.lastPeriodLabel].filter(Boolean);
      const fileName = namePieces.length > 0
        ? sanitizeFileName(namePieces.join(" "))
        : `export-${new Date().toISOString().slice(0, 10)}`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${fileName}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatus("done");
      setMessage("Export complete.");

      // Fade the status back to idle a few seconds later, instead of
      // leaving "Export complete." showing indefinitely. Guarded with
      // functional updates so this can't clobber a NEW export the person
      // already started again within that window.
      setTimeout(() => {
        setStatus((s) => (s === "done" ? "idle" : s));
        setMessage((m) => (m === "Export complete." ? "" : m));
      }, 4000);
    } catch (err: any) {
      setError(err?.message || "Export failed");
      setStatus("error");
    }
  }

  const busy = status === "working";

  return (
    <div style={{ padding: 10, maxWidth: 220, margin: "0 auto", fontSize: 12, textAlign: "center" }}>
      {initError && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left" }}>
          <strong style={{ color: "crimson", fontSize: 12 }}>Initialization Error:</strong>
          <pre style={{ marginTop: 4, fontSize: 10, whiteSpace: "pre-wrap", color: "#555" }}>{initError}</pre>
        </div>
      )}

      {!ready && !initError && <div style={{ color: "#666" }}>Connecting to Tableau...</div>}

      {ready && !config && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 10, textAlign: "left", fontSize: 11 }}>
          <strong style={{ color: "crimson" }}>This dashboard isn't configured yet.</strong>
          <p style={{ marginTop: 6, marginBottom: 3 }}>
            Add an entry to <code>lib/dashboardConfigs.ts</code> using this dashboard name as the key:
          </p>
          <pre style={{ background: "#fff", padding: 6, borderRadius: 4, overflowX: "auto", border: "1px solid #eee", fontSize: 10 }}>
            {dashboardId || "(empty — check console)"}
          </pre>
          <p style={{ marginTop: 6, marginBottom: 3 }}>Worksheets on this dashboard:</p>
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            {worksheetNames.map((w) => (
              <li key={w}>
                <code>{w}</code>
              </li>
            ))}
          </ul>
        </div>
      )}

      {ready && config && configError && (
        <div style={{ background: "#fee", border: "1px solid #fcc", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left", color: "crimson", fontSize: 11 }}>
          {configError}
        </div>
      )}

      {ready && config && !configError && (
        <>
          {error && (
            <div
              style={{
                background: "#fee",
                border: "1px solid #fcc",
                borderRadius: 6,
                padding: 8,
                marginBottom: 8,
                color: "crimson",
                textAlign: "left",
                fontSize: 11,
                maxHeight: 160,
                overflowY: "auto"
              }}
            >
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "inherit" }}>{error}</pre>
            </div>
          )}

          {status !== "idle" && !error && (
            <div style={{ background: "#f5f5f5", borderRadius: 6, padding: 8, marginBottom: 8, fontSize: 11 }}>
              {status === "done" ? "✅ " : ""}
              {message}
            </div>
          )}

          {status === "done" && warnings.length > 0 && (
            <div style={{ background: "#fff8e1", border: "1px solid #f0d58c", borderRadius: 6, padding: 8, marginBottom: 8, textAlign: "left", fontSize: 10, color: "#7a5b00" }}>
              <strong>Some fields didn't resolve:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: 14 }}>
                {warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: 4 }}>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={handleExport}
            disabled={busy}
            style={{
              width: "100%",
              padding: 8,
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
              background: busy ? "#c48086" : "#910110",
              border: "none",
              borderRadius: 6,
              cursor: busy ? "not-allowed" : "pointer"
            }}
          >
            {busy ? "Exporting..." : "Download PDF"}
          </button>
        </>
      )}
    </div>
  );
}
