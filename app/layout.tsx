import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tableau Pagination",
  description: "Export paginated Tableau reports as individual PDFs"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/*
          The Tableau Extensions API must be present on `window` BEFORE the
          React page hydrates and tries to initialize. A plain blocking
          <script> in <head> guarantees that. next/script with
          "afterInteractive" injects too late inside Tableau's sandboxed
          iframe, which is why initialization was timing out.
        */}
        <script src="/tableau-extensions.min.js" />
      </head>
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
