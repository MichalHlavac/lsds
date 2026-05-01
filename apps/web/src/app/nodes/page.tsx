// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type NodeRow, type Layer, type LifecycleStatus } from "../../lib/api";
import { LifecycleBadge } from "../../components/LifecycleBadge";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];
const STATUSES: LifecycleStatus[] = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"];
const LIMIT = 50;

export default function NodesPage() {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [layer, setLayer] = useState<Layer | "">("");
  const [nodeType, setNodeType] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | "">("");

  function fetchNodes() {
    setLoading(true);
    setError(null);
    api.nodes
      .list({
        layer: layer || undefined,
        type: nodeType || undefined,
        lifecycleStatus: status || undefined,
        limit: LIMIT,
        offset,
      })
      .then((res) => {
        setNodes(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load nodes");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchNodes();
  }, [layer, nodeType, status, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setLayer("");
    setNodeType("");
    setStatus("");
    setOffset(0);
  }

  const hasFilters = layer !== "" || nodeType !== "" || status !== "";

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Nodes</h1>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="filter-layer" className="block text-xs text-gray-400 mb-1">
            Layer
          </label>
          <select
            id="filter-layer"
            value={layer}
            onChange={(e) => {
              setLayer(e.target.value as Layer | "");
              setOffset(0);
            }}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
          >
            <option value="">All layers</option>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-type" className="block text-xs text-gray-400 mb-1">
            Type
          </label>
          <input
            id="filter-type"
            type="text"
            placeholder="e.g. Service"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
            onBlur={() => setOffset(0)}
            onKeyDown={(e) => e.key === "Enter" && setOffset(0)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-40"
          />
        </div>
        <div>
          <label htmlFor="filter-status" className="block text-xs text-gray-400 mb-1">
            Status
          </label>
          <select
            id="filter-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as LifecycleStatus | "");
              setOffset(0);
            }}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={reset}
          aria-label="Reset all filters"
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {loading ? "Loading nodes…" : error ? `Error: ${error}` : `${nodes.length} nodes loaded`}
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm" aria-label="Nodes">
          <caption className="sr-only">
            List of nodes{hasFilters ? " (filtered)" : ""}
          </caption>
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Name</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Type</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Layer</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Version</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Status</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" aria-hidden="true" />
                    Loading nodes…
                  </span>
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center">
                  <div role="alert" className="inline-flex flex-col items-center gap-2">
                    <span className="text-red-400 font-mono text-xs">{error}</span>
                    <button
                      onClick={fetchNodes}
                      className="text-sm text-gray-400 underline hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded"
                    >
                      Try again
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && nodes.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  {hasFilters
                    ? "No nodes match the current filters. Try adjusting or resetting them."
                    : "No nodes have been created yet."}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              nodes.map((node) => (
                <tr
                  key={node.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/nodes/${node.id}`}
                      className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    >
                      {node.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{node.type}</td>
                  <td className="px-4 py-2.5 text-gray-300">{node.layer}</td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{node.version}</td>
                  <td className="px-4 py-2.5">
                    <LifecycleBadge status={node.lifecycleStatus} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {new Date(node.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Nodes pagination" className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          disabled={offset === 0}
          aria-label="Previous page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500" aria-live="polite">
          {nodes.length > 0 ? `${offset + 1}–${offset + nodes.length}` : "0 results"}
        </span>
        <button
          onClick={() => setOffset(offset + LIMIT)}
          disabled={nodes.length < LIMIT}
          aria-label="Next page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}
