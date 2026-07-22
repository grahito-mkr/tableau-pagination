import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tableau Bulk PDF Export",
  description: "Export multi-page Tableau reports as batch PDFs"
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
