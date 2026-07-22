# Tableau Bulk PDF Export

A Next.js Tableau extension that exports multi-page reports as batch PDFs. Automatically detects page count, generates PDFs server-side on Vercel, and returns a ZIP download.

**Perfect for**: Qontak leads reports, employee reports, contact exports, or any paginated dashboard data.

## Features

- ✅ **Auto-detect page count** from your data (no manual configuration)
- ✅ **Server-side PDF generation** via Vercel serverless functions (fast, no UI bottleneck)
- ✅ **Batch ZIP export** – download all PDFs at once
- ✅ **Handles 100+ pages** without timeout (5-minute Vercel limit)
- ✅ **Works with any filter** – configure page filter name dynamically
- ✅ **Progress tracking** – real-time updates during export
- ✅ **Zero external dependencies** for data source (uses Tableau Extensions API)

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Tableau dashboard with a page/pagination filter

### Installation

```bash
# Clone or download the project
cd tableau-bulk-pdf-export

# Install dependencies
npm install

# Start local dev server
npm run dev
# → http://localhost:3000 (homepage)
# → http://localhost:3000/extension (Tableau extension)
```

### Deploy to Vercel

```bash
npm install -g vercel
vercel deploy
```

Vercel will:
1. Build the project
2. Deploy serverless functions (auto-configured for 5-min timeout)
3. Provide a public URL (`https://your-project.vercel.app`)

## Architecture

### Frontend (Tableau Extension)

Located at `/app/extension/page.tsx`:

1. Loads Tableau Extensions API
2. Detects available filters (dropdown auto-populated)
3. Accepts configuration:
   - **Page Filter Name** – which filter controls pagination (e.g., "Page", "Employee ID")
   - **Page Count Field** – unique identifier per page (e.g., "No", "ID")
   - **PDF Title Field** – base title for PDFs (page number appended)
4. On export click:
   - Queries data for each page via `getUnderlyingDataAsync()`
   - Sends batched data to backend
   - Downloads resulting ZIP

### Backend (Vercel Serverless)

Located at `/app/api/export-pdfs/route.ts`:

1. Receives page data array
2. For each page:
   - Uses `pdfkit` to generate PDF with table-like record layout
   - Stores in memory
3. Uses `jszip` to bundle all PDFs
4. Returns ZIP as downloadable attachment

### Data Flow

```
Tableau Dashboard
  ↓
Extension UI (page.tsx)
  ├─ Detects page count
  ├─ Loops through pages
  └─ Queries data per page
       ↓
   POST /api/export-pdfs
       ↓
   Vercel Function (route.ts)
       ├─ Generate PDF 1, 2, 3, ...
       ├─ Bundle into ZIP
       └─ Download
```

## Configuration

### In Your Dashboard

1. **Open the extension** in Tableau (add via Extensions → My Extensions)
2. **Configure:**
   - **Page Filter Name**: Select from dropdown (auto-populated from dashboard filters)
   - **Page Count Field**: Field that uniquely identifies each page
   - **PDF Title**: Base title (page number auto-appended)
3. **Click "Export All Pages as ZIP"**
4. **Browser downloads** `export-YYYY-MM-DD.zip`

### Example: Qontak Leads Report

Dashboard: "Leads with Details" (max 5 rows per page, 10 pages)

**Configuration:**
- Page Filter Name: `Page`
- Page Count Field: `No`
- PDF Title Field: `Qontak Leads Report`

**Result:**
```
export-2026-07-22.zip
├── page_1.pdf (Qontak Leads Report - Page 1)
├── page_2.pdf (Qontak Leads Report - Page 2)
├── ...
└── page_10.pdf (Qontak Leads Report - Page 10)
```

## Project Structure

```
tableau-bulk-pdf-export/
├── app/
│   ├── api/
│   │   └── export-pdfs/
│   │       └── route.ts          # Vercel serverless function (PDF generation)
│   ├── extension/
│   │   └── page.tsx              # Tableau extension UI
│   ├── layout.tsx                # Root layout
│   └── page.tsx                  # Homepage/docs
├── lib/
│   ├── tableauClient.ts          # Tableau Extensions API wrapper
│   └── exportOrchestrator.ts     # Page detection & orchestration
├── public/
│   └── tableau-extensions.min.js # Tableau Extensions SDK (add manually)
├── package.json
├── next.config.mjs
├── tsconfig.json
├── vercel.json                   # Vercel configuration
└── README.md
```

## Important: Tableau Extensions SDK

**The `public/tableau-extensions.min.js` file is required but not included in the repo** (it's large and updated by Tableau).

### Download it:

1. Visit: https://github.com/tableau/extensions-api/releases
2. Download the latest `tableau-extensions-*.js` file
3. Rename it to `tableau-extensions.min.js`
4. Place it in the `public/` folder

Or use curl:
```bash
curl -o public/tableau-extensions.min.js \
  https://raw.githubusercontent.com/tableau/extensions-api/main/Samples/docs/tableau-extensions.min.js
```

## API Reference

### POST `/api/export-pdfs`

**Request:**
```json
{
  "totalPages": 10,
  "data": [
    {
      "pageNumber": 1,
      "title": "Report - Page 1",
      "records": [
        { "name": "John", "email": "john@example.com", ... },
        { "name": "Jane", "email": "jane@example.com", ... }
      ]
    },
    ...
  ]
}
```

**Response:**
- Content-Type: `application/zip`
- Body: ZIP file with `page_1.pdf`, `page_2.pdf`, etc.

## Limitations

| Limitation | Details |
|-----------|---------|
| **Timeout** | Vercel serverless: 300 seconds (5 min) |
| **PDF Rate** | ~1 PDF/second per function |
| **Max Pages** | ~300 pages within 5-min timeout |
| **Data per Page** | Configurable (default 100 rows) |
| **Concurrent Exports** | 10 per account (Vercel limit) |

## Troubleshooting

### "Tableau Extensions API not loaded"
- Check that `public/tableau-extensions.min.js` exists
- Open browser DevTools → Console for errors
- Ensure extension is loaded in Tableau (not just a regular webpage)

### "No filters found"
- Dashboard must have at least one filter
- Filters must be applied to the worksheet
- Reload the extension after adding filters

### "Export timeout after 5 minutes"
- Vercel limit reached
- Reduce `maxRecordsPerPage` in code (default 100)
- Split into smaller page ranges

### "ZIP is empty or corrupt"
- Check Vercel logs: `vercel logs --follow`
- Ensure data is being queried correctly
- Try exporting 1-2 pages first for debugging

## Development

### Local Development

```bash
npm run dev
# → http://localhost:3000
```

### Build for Production

```bash
npm run build
npm start
```

### Testing the API Directly

```bash
curl -X POST http://localhost:3000/api/export-pdfs \
  -H "Content-Type: application/json" \
  -d '{
    "totalPages": 1,
    "data": [{
      "pageNumber": 1,
      "title": "Test Report",
      "records": [{"name": "Test", "value": "123"}]
    }]
  }' \
  --output test.zip
```

## Extending

### Customize PDF Layout

Edit `/app/api/export-pdfs/route.ts`, function `generatePDF()`:
- Change fonts, colors, margins
- Add headers/footers
- Include charts or images (base64)
- Use different record formatting

### Add Image Support

```typescript
// In generatePDF()
doc.image(buffer, 50, 100, { width: 500 });
```

### Support Multiple Data Sources

Update `tableauClient.ts`:
- Add `queryHologres()` or `queryMaxCompute()` methods
- Fall back to Tableau API if direct DB access needed

## Environment Variables

None required! The extension uses Tableau's native Extensions API for:
- Authentication (Tableau Cloud PAT)
- Data querying (VizQL Data Service)
- Filter management

## Performance Tips

1. **Reduce records per page** if export times out:
   ```typescript
   maxRecordsPerPage: 50  // instead of 100
   ```

2. **Pre-filter data** in Tableau before exporting:
   - Apply date range, department filters
   - Reduces data per page

3. **Use summary data** for faster queries:
   ```typescript
   const records = await client.getSummaryData(50);
   ```

## Contributing

Improvements welcome! Consider:
- Custom PDF templates
- Chart embedding
- Multi-language support
- Progress webhooks

## License

MIT

## Support

- **Tableau Extensions API Docs**: https://tableau.github.io/extensions-api/
- **Vercel Docs**: https://vercel.com/docs
- **PDFKit Docs**: http://pdfkit.org/docs/getting_started.html
- **JSZip Docs**: https://stuk.github.io/jszip/

---

**Built for Mekari Data Team** – Multi-page Tableau report batching made simple.
