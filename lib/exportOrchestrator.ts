/**
 * Orchestrates multi-page PDF export
 * 1. Detects page count
 * 2. Queries data for each page
 * 3. Calls backend API to generate and ZIP PDFs
 */

import { TableauClient } from "./tableauClient";

export interface PageData {
  pageNumber: number;
  title: string;
  records: Array<Record<string, unknown>>;
}

export interface ExportOptions {
  pageFilterName: string;
  pageCountField: string; // Field name that identifies unique page numbers
  titleField?: string;
  maxRecordsPerPage?: number;
  onProgress?: (current: number, total: number) => void;
}

export class ExportOrchestrator {
  private client: TableauClient;

  constructor(client: TableauClient) {
    this.client = client;
  }

  /**
   * Detect total page count from underlying data
   * Gets all data (unfiltered by page) and counts distinct page values
   */
  async detectPageCount(pageCountField: string): Promise<number> {
    // Temporarily clear page filter to see all pages
    try {
      await this.client.clearFilter("Page");
    } catch {
      // Filter may not exist, continue
    }

    const allData = await this.client.getUnderlyingData(100000);
    const pageNumbers = new Set(allData.map((row) => row[pageCountField]));
    return pageNumbers.size;
  }

  /**
   * Export all pages as ZIP
   */
  async exportAllPages(options: ExportOptions): Promise<Blob> {
    const {
      pageFilterName,
      pageCountField,
      titleField = "Dashboard Title",
      maxRecordsPerPage = 100,
      onProgress
    } = options;

    // 1. Detect total pages
    const totalPages = await this.detectPageCount(pageCountField);
    onProgress?.(0, totalPages);

    // 2. Collect data for each page
    const pageDataList: PageData[] = [];

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      // Apply filter to show only this page
      await this.client.applyFilter(pageFilterName, pageNum);

      // Small delay for Tableau render
      await new Promise((r) => setTimeout(r, 300));

      // Query data for this page
      const pageRecords = await this.client.getUnderlyingData(maxRecordsPerPage);

      const pageData: PageData = {
        pageNumber: pageNum,
        title: `${titleField} - Page ${pageNum}`,
        records: pageRecords
      };

      pageDataList.push(pageData);
      onProgress?.(pageNum, totalPages);
    }

    // 3. Send to backend for PDF generation + ZIP
    const response = await fetch("/api/export-pdfs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        totalPages,
        data: pageDataList
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(`Export failed: ${err.error}`);
    }

    return response.blob();
  }
}
