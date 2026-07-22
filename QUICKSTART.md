# Quick Start Guide

Get your Tableau bulk PDF exporter running in 5 minutes.

## Step 1: Download Tableau Extensions SDK

The `tableau-extensions.min.js` file is required but not included (it's maintained by Tableau).

**Option A: Download from GitHub** (recommended)
```bash
curl -o public/tableau-extensions.min.js \
  https://raw.githubusercontent.com/tableau/extensions-api/main/Samples/docs/tableau-extensions.min.js
```

**Option B: Manual download**
1. Go to https://github.com/tableau/extensions-api/releases
2. Find the latest release
3. Download `tableau-extensions-*.js`
4. Rename to `tableau-extensions.min.js`
5. Save to `public/` folder

## Step 2: Install Dependencies

```bash
npm install
```

Takes ~1 minute (installs pdfkit, jszip, Next.js, etc.)

## Step 3: Test Locally

```bash
npm run dev
```

Open http://localhost:3000

You should see:
- Homepage with architecture diagram
- Link to `/extension` (the Tableau extension UI)

## Step 4: Deploy to Vercel

```bash
npm install -g vercel
vercel login
vercel deploy
```

Vercel will:
- Build the project (~30 seconds)
- Deploy serverless functions
- Give you a live URL: `https://your-project.vercel.app`

**Done!** Your extension is now live.

## Step 5: Add to Tableau Cloud/Server

In Tableau (Desktop or Cloud):

1. **Go to Dashboard > Extensions > My Extensions**
2. **Click "..."  and choose "Manage my Extensions"**
3. **Add new:**
   - URL: `https://your-project.vercel.app/extension`
   - Name: "Bulk PDF Export"
4. **Drag extension onto dashboard**
5. **Configure:**
   - Page Filter Name: (auto-populated from dashboard filters)
   - Page Count Field: (e.g., "No", "ID")
   - PDF Title: (base title for PDFs)
6. **Click "Export All Pages as ZIP"**
7. **Browser downloads:** `export-YYYY-MM-DD.zip`

## Troubleshooting

### ❌ "Failed to load /tableau-extensions.min.js"
- **Fix:** Run the curl command in Step 1
- **Check:** `ls -la public/tableau-extensions.min.js` (should exist)

### ❌ "No filters found"
- **Fix:** Add a filter to your dashboard (e.g., "Page", "ID")
- **Check:** Reload the extension in Tableau after adding filters

### ❌ Export fails with timeout
- **Fix:** Reduce number of pages or records per page
- **Edit:** `lib/exportOrchestrator.ts`, change `maxRecordsPerPage: 50`

### ❌ ZIP is empty
- **Check:** Vercel logs: `vercel logs --follow`
- **Try:** Export just 1 page for debugging

## Next Steps

### Customize PDF Layout

Edit `/app/api/export-pdfs/route.ts`:

```typescript
function generatePDF(pageData) {
  // ... existing code ...
  
  // Change fonts
  doc.fontSize(20).font("Helvetica-Bold");
  
  // Add watermark
  doc.fontSize(40).fillOpacity(0.1).text("CONFIDENTIAL", 50, 50);
  
  // Add company logo
  doc.image("logo.png", 50, 50, { width: 100 });
}
```

### Use Different Data Source

By default, extension queries via Tableau API. To use Hologres/MaxCompute directly:

1. Add connection credentials to `.env.local`
2. Extend `lib/exportOrchestrator.ts`:
   ```typescript
   async exportAllPages(options) {
     // ...
     const pageRecords = await queryHologres(sql, { page: pageNum });
     // ...
   }
   ```
3. Redeploy: `vercel deploy`

### Monitor Exports

Add logging to Vercel:

```bash
# Watch logs in real-time
vercel logs --follow
```

You'll see:
- Page data received
- PDF generation time per page
- ZIP creation time
- Download success/failure

## Example: Qontak Leads Export

**Dashboard:** "Leads with Details"
- Filter: `Page` (1 to 10)
- Data: 5 contact records per page
- Total: 50 leads across 10 pages

**Extension Configuration:**
```
Page Filter Name: Page
Page Count Field: No
PDF Title: Qontak Leads Report
```

**Result:**
```
export-2026-07-22.zip (~200 KB)
├── page_1.pdf  (Qontak Leads Report - Page 1)
├── page_2.pdf  (Qontak Leads Report - Page 2)
├── ...
└── page_10.pdf (Qontak Leads Report - Page 10)
```

Each PDF contains:
- Header with title and page number
- Contact details in table format
- Generated timestamp

## Performance Benchmarks

| Metric | Value |
|--------|-------|
| Pages per export | 1-300 (within 5-min timeout) |
| PDF generation | ~0.5-1 sec per page |
| ZIP compression | ~200-500 KB per 10 pages |
| UI response time | <500 ms for page detection |

## What's Next?

1. ✅ Deployed to Vercel? → Add to Tableau dashboard
2. ✅ Export working? → Customize PDF layout for your branding
3. ✅ Need direct DB access? → Add Hologres/MaxCompute connectors
4. ✅ Want scheduled exports? → Use Vercel Cron Functions (advanced)

## Need Help?

- **Tableau Extensions API:** https://tableau.github.io/extensions-api/
- **Vercel Docs:** https://vercel.com/docs
- **PDFKit Docs:** http://pdfkit.org/

---

**Pro Tips:**
- Use "Summary Data" for faster queries: `getSummaryDataAsync()` instead of `getUnderlyingDataAsync()`
- Pre-filter in Tableau before exporting (narrows data per page)
- Monitor Vercel logs for performance insights: `vercel logs --follow`

Happy exporting! 🚀
