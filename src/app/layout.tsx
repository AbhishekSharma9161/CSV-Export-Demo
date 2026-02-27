import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "DataFlow — Large Dataset CSV Export",
  description: "Stream and export up to 1M rows from a paginated, filtered table with resumable progress.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
