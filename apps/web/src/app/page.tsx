// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import Link from "next/link";

interface NavCard {
  href: string;
  title: string;
  description: string;
  accent: string;
}

const CARDS: NavCard[] = [
  {
    href: "/graph",
    title: "Graph Canvas",
    description: "Visualise nodes and edges as an interactive topology map.",
    accent: "border-blue-700 hover:border-blue-500",
  },
  {
    href: "/nodes",
    title: "Nodes",
    description: "Browse, filter, sort, and bulk-manage all nodes in the tenant.",
    accent: "border-gray-700 hover:border-gray-500",
  },
  {
    href: "/edges",
    title: "Edges",
    description: "Explore relationships between nodes with type and layer filters.",
    accent: "border-gray-700 hover:border-gray-500",
  },
  {
    href: "/layers",
    title: "Layers",
    description: "Inspect architectural layers and drill into their member nodes.",
    accent: "border-gray-700 hover:border-gray-500",
  },
  {
    href: "/violations",
    title: "Violations",
    description: "Review compliance violations, resolve issues, or bulk-dismiss.",
    accent: "border-red-900 hover:border-red-700",
  },
];

export default function HomePage() {
  return (
    <div className="max-w-3xl">
      <div className="mb-10">
        <h1 className="text-3xl font-bold mb-2">LSDS</h1>
        <p className="text-gray-400">
          Typed knowledge graph — single source of truth for software architecture.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {CARDS.map((card) => (
          <Link
            key={card.href}
            href={card.href}
            className={`rounded-lg border bg-gray-900 p-5 transition-colors ${card.accent}`}
          >
            <h2 className="text-base font-semibold text-gray-100 mb-1">{card.title}</h2>
            <p className="text-sm text-gray-400">{card.description}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
