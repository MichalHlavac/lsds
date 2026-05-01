// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "../components/Sidebar";

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
      <body className="flex bg-gray-950 text-gray-100 min-h-screen">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-gray-800 focus:px-4 focus:py-2 focus:text-sm focus:text-white focus:ring-2 focus:ring-blue-500"
        >
          Skip to content
        </a>
        <Sidebar />
        <main id="main-content" className="flex-1 p-8" tabIndex={-1}>
          {children}
        </main>
      </body>
    </html>
  );
}
