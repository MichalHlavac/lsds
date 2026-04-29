// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

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
