import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import zlib from "zlib";
import type { ColumnSpec } from "@/lib/dashboardConfigs";
// Types only here (erased at compile time, zero runtime risk). The actual
// `renderAllPages`/`renderCompact` functions are imported dynamically inside
// the try block below instead of statically up here — see the comment
// there for why.
import type { PageData, ExportMeta } from "@/lib/pdfRenderer";

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
    // Loaded dynamically (not as a top-of-file static import) specifically
    // so that if THIS import itself fails — e.g. pdfkit's font/data files
    // being missing at runtime in this particular deployment, or any other
    // module-load-time problem inside pdfRenderer.ts/pdfkit — it happens
    // HERE, inside our own try/catch, instead of before Next.js even routes
    // the request to this handler. A static-import-time failure crashes
    // before any of our code runs at all, which Next.js reports as its own
    // generic, no-detail 500 page — completely invisible to us. Moving the
    // import inside the try turns that same failure into a normal caught
    // exception with a real message we can return and show in the UI.
    const { renderAllPages, renderCompact } = await import("@/lib/pdfRenderer");

    // The client gzip-compresses the request body for large (many-employee,
    // compact-mode) exports to stay under Vercel's request size limit — see
    // `ExportOrchestrator.export()`. Decode it back to the original JSON
    // text ourselves when that header is present; otherwise read the body
    // as plain JSON as before.
    // Gzip decoding buffers the whole request twice (compressed +
    // decompressed text) before JSON.parse makes a third copy as parsed
    // objects. That's unavoidable for reading the input, but we drop each
    // reference as soon as we're done with it (rather than keeping
    // `compressed`/`bodyText` alive for the rest of the request) so they're
    // eligible for garbage collection before the memory-heavier PDF-building
    // step below runs.
    let body: ExportRequest;
    if (req.headers.get("content-encoding") === "gzip") {
      const compressed = Buffer.from(await req.arrayBuffer());
      const bodyText = zlib.gunzipSync(compressed).toString("utf-8");
      body = JSON.parse(bodyText);
    } else {
      const bodyText = await req.text();
      body = JSON.parse(bodyText);
    }
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

    // Streaming the raw PDFDocument straight into the response (an earlier
    // version of this fix) saved memory in theory, but Vercel's Node.js
    // serverless functions don't reliably deliver a true streamed body —
    // every export came back corrupted once actually deployed. Back to a
    // fully-buffered Buffer, which is what's proven to produce valid PDFs.
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