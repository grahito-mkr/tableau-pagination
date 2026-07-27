import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import type { ColumnSpec } from "@/lib/dashboardConfigs";
import { renderAllPages, renderCompact, type PageData, type ExportMeta } from "@/lib/pdfRenderer";

export const runtime = "nodejs";
export const maxDuration = 300;

interface ExportRequest {
  pages: PageData[];
  /** Optional PDF column layout from the dashboard's config. When present it
   * decides which columns show, their order, labels and widths. When absent,
   * every returned field is rendered generically. */
  layout?: ColumnSpec[];
  /** Whole-export metadata: logo top-left, print date/by/page top-right. Drawn
   * once at the top of every physical PDF page. */
  meta?: ExportMeta;
  /** When true, `pages` is a single flattened page (all rows, one logical
   * unit) and rendering uses the dynamic/compact packer (`renderCompact`)
   * instead of the classic per-Tableau-page renderer (`renderAllPages`). */
  compact?: boolean;
  /** Diagnostics collected client-side during `buildPages` (e.g. "Print by"/
   * "Period" fields that didn't resolve). Printed here with console.warn so
   * they land in the Next.js dev server's own terminal output — the
   * extension itself runs inside Tableau's embedded webview, which has no
   * console visible from VS Code. */
  warnings?: string[];
}

export async function POST(req: NextRequest) {
  try {
    const body: ExportRequest = await req.json();
    const { pages, layout, meta, compact, warnings } = body;

    if (!Array.isArray(pages) || pages.length === 0) {
      return NextResponse.json({ error: "No pages to export." }, { status: 400 });
    }

    if (warnings && warnings.length > 0) {
      console.warn(`--- Export diagnostics (${warnings.length}) ---`);
      for (const w of warnings) console.warn(w);
      console.warn("--- end export diagnostics ---");
    }

    // Best-effort logo load: a missing/misconfigured file just means no logo
    // is drawn, it never fails the whole export — but log it so a wrong path
    // shows up in server logs instead of failing silently.
    let logoBuffer: Buffer | null = null;
    if (meta?.logo?.path) {
      const abs = path.join(process.cwd(), "public", meta.logo.path.replace(/^\/+/, ""));
      try {
        logoBuffer = fs.readFileSync(abs);
      } catch (err: any) {
        console.warn(`Logo not loaded (export will render without it). Looked for: ${abs}. Reason: ${err?.message || err}`);
        logoBuffer = null;
      }
    }

    const pdfBuffer = compact
      ? await renderCompact(
          pages[0].rows,
          pages[0].columns,
          pages[0].header,
          layout,
          meta,
          logoBuffer,
          pages[0].signature
        )
      : await renderAllPages(pages, layout, meta, logoBuffer);

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="tableau-export-${Date.now()}.pdf"`
      }
    });
  } catch (err: any) {
    console.error("Export error:", err);
    return NextResponse.json({ error: err?.message || "Export failed" }, { status: 500 });
  }
}