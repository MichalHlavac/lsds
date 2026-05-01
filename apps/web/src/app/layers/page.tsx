// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type LayerSummary } from "../../lib/api";

export default function LayersPage() {
  const [layers, setLayers] = useState<LayerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.layers
      .list()
      .then((res) => {
        setLayers(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load layers");
        setLoading(false);
      });
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Layers</h1>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Layer</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Nodes</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-red-400 font-mono text-xs">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && layers.length === 0 && (
              <tr>
                <td colSpan={2} className="px-4 py-8 text-center text-gray-500">
                  No layers found
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              layers.map((item) => (
                <tr
                  key={item.layer}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/layers/${item.layer.toLowerCase()}`}
                      className="text-blue-400 hover:text-blue-300 font-mono"
                    >
                      {item.layer}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{item.nodeCount}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
