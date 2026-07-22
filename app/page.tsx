export default function Home() {
  return (
    <div style={{ padding: 40, maxWidth: 700, margin: "0 auto" }}>
      <h1>Tableau Bulk PDF Export</h1>
      <p>
        Export multi-page Tableau reports as batch PDFs. Perfect for Qontak contact leads, employee reports, or any paginated dashboard data.
      </p>

      <h2>How it works</h2>
      <ol>
        <li><strong>Load the extension</strong> in your Tableau dashboard</li>
        <li><strong>Configure page filter</strong> – specify which filter controls pagination</li>
        <li><strong>Click "Export All Pages"</strong> – backend generates PDFs for each page</li>
        <li><strong>Download ZIP</strong> – contains page_1.pdf, page_2.pdf, etc.</li>
      </ol>

      <h2>Key features</h2>
      <ul>
        <li>✅ Auto-detects page count from your data</li>
        <li>✅ Server-side PDF generation (fast, no UI bottleneck)</li>
        <li>✅ Handles 100+ pages without timeout (Vercel 5-min limit)</li>
        <li>✅ ZIP download with all PDFs</li>
        <li>✅ Works with any page/pagination filter</li>
      </ul>

      <h2>Architecture</h2>
      <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 4, overflow: "auto" }}>
{`Frontend (Tableau Extension)
├── Detects page filter names
├── Queries data for each page
└── Calls /api/export-pdfs

Backend (Vercel Serverless)
├── Receives page data
├── Generates PDF per page (pdfkit)
├── Creates ZIP (jszip)
└── Returns as download

Database
├── MaxCompute (ODPS) or Hologres
└── Queried via Tableau Extensions API
`}
      </pre>

      <h2>Deployment</h2>
      <pre style={{ background: "#f5f5f5", padding: 16, borderRadius: 4, overflow: "auto" }}>
{`# Install dependencies
npm install

# Deploy to Vercel
vercel deploy

# Or develop locally
npm run dev
# → Visit http://localhost:3000/extension (Tableau extension)
# → Visit http://localhost:3000 (home/docs)
`}
      </pre>

      <h2>Environment Variables</h2>
      <p>None required! The extension uses Tableau's native Extensions API for authentication and data querying.</p>

      <h2>Configuration (in Tableau Extension)</h2>
      <ul>
        <li><strong>Page Filter Name</strong> – dropdown auto-populated from your dashboard filters</li>
        <li><strong>Page Count Field</strong> – unique identifier per page (e.g., "No", "Employee ID")</li>
        <li><strong>PDF Title Field</strong> – base title for each PDF (page number auto-appended)</li>
      </ul>

      <h2>Example: Qontak Contact Leads</h2>
      <p>
        For your "Leads with Details" report (5 rows per page, 10 pages):
      </p>
      <ul>
        <li><strong>Page Filter Name:</strong> "Page"</li>
        <li><strong>Page Count Field:</strong> "No"</li>
        <li><strong>PDF Title:</strong> "Qontak Leads Report"</li>
      </ul>
      <p>
        Result: <code>export-2026-07-22.zip</code> containing page_1.pdf through page_10.pdf
      </p>

      <h2>Limitations & Notes</h2>
      <ul>
        <li>Vercel serverless timeout: 5 minutes (300 seconds)</li>
        <li>PDF generation rate: ~1 PDF per second per function instance</li>
        <li>Max 10 concurrent exports per account (use concurrency limits for high volume)</li>
        <li>Each page queried individually (respects Tableau filters/row limits)</li>
      </ul>
    </div>
  );
}
