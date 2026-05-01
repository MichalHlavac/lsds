// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LAYERS = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`block px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-gray-700 text-white"
          : "text-gray-400 hover:text-gray-100 hover:bg-gray-800"
      }`}
    >
      {children}
    </Link>
  );
}

export function Sidebar() {
  return (
    <nav
      aria-label="Main navigation"
      className="w-56 shrink-0 bg-gray-950 border-r border-gray-800 min-h-screen p-4 flex flex-col gap-6"
    >
      <div>
        <p
          id="nav-layers"
          className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Layers
        </p>
        <ul className="space-y-0.5" aria-labelledby="nav-layers">
          {LAYERS.map((layer) => (
            <li key={layer}>
              <NavLink href={`/layers/${layer.toLowerCase()}`}>{layer}</NavLink>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p
          id="nav-graph"
          className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Graph
        </p>
        <ul className="space-y-0.5" aria-labelledby="nav-graph">
          <li>
            <NavLink href="/nodes">Nodes</NavLink>
          </li>
          <li>
            <NavLink href="/edges">Edges</NavLink>
          </li>
        </ul>
      </div>
      <div>
        <p
          id="nav-compliance"
          className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500"
        >
          Compliance
        </p>
        <ul className="space-y-0.5" aria-labelledby="nav-compliance">
          <li>
            <NavLink href="/violations">Violations</NavLink>
          </li>
        </ul>
      </div>
    </nav>
  );
}
