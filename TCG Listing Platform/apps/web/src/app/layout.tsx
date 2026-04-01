import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TCG Listing Platform",
  description:
    "Web-first Pokemon card intake platform for turning video or image uploads into reviewable inventory and eBay-ready CSV exports.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
