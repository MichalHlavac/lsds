import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LSDS",
  description: "Typed knowledge graph SSOT for software knowledge",
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
