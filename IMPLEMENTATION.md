# Implementation Notes

## Architecture Decisions

### 1. Why Server-Side PDF Generation?

**Problem:** Clicking through 10+ pages in Tableau UI to export each one is slow and painful.

**Solution:** Server-side serverless function (Vercel) generates all PDFs in parallel:
- **Frontend:** Only queries data once per page (async), sends to backend
- **Backend:** Generates PDFs in parallel, zips them, returns download
- **Result:** 10 pages = 1-2 seconds (vs 30+ seconds of UI clicking)

### 2. Why Not Use Tableau's PDF Export?

Tableau's `createVizImageAsync()` API:
- ❌ Requires rendering each viz in the extension UI (slow)
- ❌ Only captures current page (need loop + delay)
- ❌ Rate-limited (1-2 images/second)
- ❌ Renders entire view (includes filters, headers, etc.)

**Our approach:**
- ✅ Query raw data, render on server
- ✅ Batch generation (parallel)
- ✅ Customizable layout (fonts, spacing, branding)
- ✅ No UI bottleneck

### 3. Why Vercel + Serverless?

**Alternatives considered:**
- ❌ Railway/Fly.io: Need to manage uptime, scaling
- ❌ AWS Lambda: More config, cold starts slower
- ✅ Vercel: Same deployment as Next.js app, auto-scaling, 5-min timeout perfect for bulk exports

### 4. Page Count Detection

**How it works:**
1. Clear page filter (temporary)
2. Query all data: `getUnderlyingDataAsync({ maxRows: 100000 })`
3. Count distinct values in `pageCountField` (e.g., "No")
4. Returns page count without manual configuration

**Why not hardcode?**
- Dashboards change (filter values, row counts)
- Auto-detection = zero config for users

### 5. Data Flow Design

```
Extension UI (page.tsx)
  └─ User clicks "Export"
     ├─ Detect page count (clear filter, query data)
     ├─ Loop 1..totalPages
     │  ├─ Apply filter: pageNumber
     │  ├─ Wait 300ms (Tableau render)
     │  └─ Query data: getUnderlyingDataAsync()
     └─ Send batch data to backend

Backend (route.ts)
  └─ Receive [{ pageNumber, title, records }, ...]
     ├─ For each page:
     │  ├─ Create PDF with pdfkit
     │  └─ Buffer chunks
     ├─ Create ZIP with jszip
     └─ Return as download
```

**Why batch instead of one-at-a-time?**
- ✅ Parallel PDF generation on backend
- ✅ Single HTTP roundtrip
- ✅ Better error handling (all-or-nothing)
- ✅ Easier progress tracking

## Technical Choices

### PDFKit over ReportLab/pyppeteer

**PDFKit (Node.js):**
- ✅ Built-in PDF primitives (text, images, tables)
- ✅ Pure JS (no system dependencies)
- ✅ Works on Vercel serverless
- ❌ Limited styling vs browser-rendered PDFs

**Alternatives:**
- ReportLab (Python): Requires Python runtime, slower cold start
- Puppeteer: Heavy (Chrome), slow, expensive on serverless
- pdfmake: Similar to PDFKit but more table support

**Decision:** PDFKit is best fit for Vercel — minimal footprint, fast cold start, good enough for record layout.

### JSZip over Node's `zlib`

**JSZip:**
- ✅ Browser-compatible (future client-side zipping)
- ✅ Simple API
- ✅ Widely used

**Node `zlib`:**
- ✅ Slightly smaller
- ❌ No browser support

**Decision:** JSZip because future improvements might include client-side compression option.

### Vercel 5-minute timeout

**Calculation:**
- Per page overhead: ~200ms (data query + PDF generation)
- 300 pages × 0.2s = 60s = safe buffer

**Limit hit at:** ~250 pages (4 min 10 sec), includes ZIP creation

**If you need 300+:** Implement pagination (e.g., export page 1-100, 101-200, etc.)

## Future Enhancements

### 1. Custom PDF Templates

Currently: Simple text layout with records as key-value pairs

Enhancement: Accept Handlebars/Nunjucks template:
```typescript
// In POST body
{
  "template": "{{title}}\n{% for record in records %}...",
  "data": [...]
}
```

### 2. Chart Embedding

Use chart rendering library (e.g., Chart.js + canvas-to-image):
```typescript
const chart = await renderChart(pageData.metrics);
doc.image(chart, 50, 200, { width: 400 });
```

### 3. Direct DB Querying

Add Hologres/MaxCompute connectors instead of Tableau API:
```typescript
// In exportOrchestrator.ts
async queryPage(pageNum) {
  return await hologresClient.query(
    `SELECT * FROM leads WHERE page = ${pageNum} LIMIT 100`
  );
}
```

**Benefit:** Faster, no Tableau filter overhead

### 4. Scheduled Exports

Use Vercel Cron Functions:
```typescript
// app/api/scheduled-export/route.ts
export async function GET(req: Request) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Query Hologres, generate PDFs, email user
  const zip = await generateExport();
  await sendEmail('user@example.com', zip);
}
```

### 5. Progress Webhooks

Stream PDF generation progress:
```typescript
// Backend sends progress events
for (const page of pages) {
  const pdf = await generatePDF(page);
  await fetch(progressWebhook, {
    method: 'POST',
    body: JSON.stringify({ page: page.number, status: 'done' })
  });
}
```

### 6. Multi-format Export

Support Word, Excel, JSON alongside PDFs:
```typescript
// route.ts
if (format === 'xlsx') {
  return await generateExcel(data);
} else if (format === 'docx') {
  return await generateDocx(data);
}
```

## Performance Tuning

### Reduce Query Time

**Current:**
```typescript
const data = await worksheet.getUnderlyingDataAsync({ maxRows: 100000 });
```

**For 100+ pages, consider:**
```typescript
// Only get fields you need
const data = await worksheet.getUnderlyingDataAsync({ 
  maxRows: 50,  // Reduce to essential fields
  // Filter applied in Tableau UI first
});
```

### Parallel PDF Generation

Currently sequential. For faster generation:
```typescript
// Parallel with Promise.all
const pdfBuffers = await Promise.all(
  pageDataList.map(page => generatePDF(page))
);
```

**Trade-off:** Higher memory usage. Monitor with `vercel logs`.

### Cache Page Metadata

First export detects page count. If exporting same dashboard multiple times:
```typescript
// Save to browser localStorage
const cached = localStorage.getItem('pageCount:dashboardId');
if (cached) return parseInt(cached);
```

## Debugging

### Local Development

```bash
# Watch extension load
open "http://localhost:3000/extension"

# Monitor API in browser console
fetch('/api/export-pdfs', {...})
  .then(r => r.blob())
  .then(blob => console.log(blob.size))
```

### Vercel Production

```bash
# Real-time logs
vercel logs --follow

# Look for:
# - "Export error: ..."
# - PDF generation timing per page
# - ZIP file size
```

### Common Issues

**"Sheet contains no data"**
- Vercel is receiving empty `records` array
- Check that Tableau filter is applying correctly
- Verify `maxRows` isn't too low

**"ZIP file empty or corrupt"**
- PDF generation failed (check Vercel logs)
- JSZip add() called with wrong buffer type
- Fix: Ensure `generatePDF()` returns `Buffer`, not `Uint8Array`

**"Timeout after 4 minutes"**
- 300+ pages or very large records
- Reduce `maxRecordsPerPage` or split exports

## Testing

### Unit Tests (future)

```typescript
// lib/__tests__/exportOrchestrator.test.ts
describe('ExportOrchestrator', () => {
  it('should detect page count', async () => {
    // Mock TableauClient
    // Assert pageCount = 10
  });
});
```

### Integration Tests (future)

```bash
# Mock Tableau extension
npm test:integration

# Exports full ZIP, validates contents
```

### Load Testing

```bash
# Simulate concurrent exports
ab -n 10 -c 5 https://your-project.vercel.app/api/export-pdfs
```

## Security Considerations

### ✅ Current Protection

1. **Tableau authentication:** Extension only loads if user is logged in
2. **Data isolation:** Each extension instance queries dashboard context (scoped to user's access)
3. **No credentials in requests:** Uses Tableau's session token

### ⚠️ To Add (future)

1. **Rate limiting:** Limit exports per user per hour
2. **Data masking:** Strip PII fields in PDFs
3. **Audit logging:** Log who exported what, when
4. **Encryption:** Encrypt ZIPs in transit (HTTPS + TLS)

## Cost Analysis (Vercel)

**Monthly estimate (10 exports/day):**
- Compute: 0.3 hrs/month = ~free tier
- Bandwidth: ~1 MB/day × 30 = 30 MB = free tier
- Storage: Negligible (PDFs generated on-the-fly)

**Result:** ✅ **Fits within Vercel Free Tier** (for typical usage)

**Scaling:**
- 100 exports/day: Still free
- 1000 exports/day: ~$15/month (Pro)
- 10000 exports/day: Consider dedicated server

---

## Deployment Checklist

- [ ] Download `tableau-extensions.min.js` to `public/`
- [ ] Run `npm install` locally
- [ ] Test with `npm run dev`
- [ ] Deploy: `vercel deploy`
- [ ] Add extension URL to Tableau Cloud/Server
- [ ] Test export with 1 page
- [ ] Test export with 10+ pages
- [ ] Monitor Vercel logs during export
- [ ] Share extension URL with team

---

**Questions?** See README.md or QUICKSTART.md
