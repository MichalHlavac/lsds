// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type EdgeRow } from "../../lib/api";
import { LifecycleBadge } from "../../components/LifecycleBadge";

const LIMIT = 50;

function truncId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default function EdgesPage() {
  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [edgeType, setEdgeType] = useState("");

  function fetchEdges() {
    setLoading(true);
    setError(null);
    api.edges
      .list({
        sourceId: sourceId || undefined,
        targetId: targetId || undefined,
        type: edgeType || undefined,
        limit: LIMIT,
        offset,
      })
      .then((res) => {
        setEdges(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load edges");
        setLoading(false);
      });
  }

  useEffect(() => {
    fetchEdges();
  }, [sourceId, targetId, edgeType, offset]); // eslint-disable-line react-hooks/exhaustive-deps

  function reset() {
    setSourceId("");
    setTargetId("");
    setEdgeType("");
    setOffset(0);
  }

  const hasFilters = sourceId !== "" || targetId !== "" || edgeType !== "";

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Edges</h1>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <FilterInput
          id="filter-source"
          label="Source ID"
          value={sourceId}
          onChange={(v) => {
            setSourceId(v);
            setOffset(0);
          }}
        />
        <FilterInput
          id="filter-target"
          label="Target ID"
          value={targetId}
          onChange={(v) => {
            setTargetId(v);
            setOffset(0);
          }}
        />
        <FilterInput
          id="filter-type"
          label="Type"
          value={edgeType}
          onChange={(v) => {
            setEdgeType(v);
            setOffset(0);
          }}
        />
        <button
          onClick={reset}
          aria-label="Reset all filters"
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading ? "Loading edges…" : error ? `Error: ${error}` : `${edges.length} edges loaded`}
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm" aria-label="Edges">
          <caption className="sr-only">
            List of edges{hasFilters ? " (filtered)" : ""}
          </caption>
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Type</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Layer</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Source → Target
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Weight</th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-4 w-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" aria-hidden="true" />
                    Loading edges…
                  </span>
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center">
                  <div role="alert" className="inline-flex flex-col items-center gap-2">
                    <span className="text-red-400 font-mono text-xs">{error}</span>
                    <button
                      onClick={fetchEdges}
                      className="text-sm text-gray-400 underline hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded"
                    >
                      Try again
                    </button>
                  </div>
                </td>
              </tr>
            )}
            {!loading && !error && edges.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  {hasFilters
                    ? "No edges match the current filters. Try adjusting or resetting them."
                    : "No edges have been created yet."}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              edges.map((edge) => (
                <tr
                  key={edge.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/edges/${edge.id}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                    >
                      {edge.type}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{edge.layer}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <Link
                        href={`/nodes/${edge.sourceId}`}
                        className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                        aria-label={`Source node ${edge.sourceId}`}
                      >
                        {truncId(edge.sourceId)}
                      </Link>
                      <span aria-hidden="true" className="text-gray-500">→</span>
                      <Link
                        href={`/nodes/${edge.targetId}`}
                        className="text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                        aria-label={`Target node ${edge.targetId}`}
                      >
                        {truncId(edge.targetId)}
                      </Link>
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">
                    {edge.traversalWeight}
                  </td>
                  <td className="px-4 py-2.5">
                    <LifecycleBadge status={edge.lifecycleStatus} />
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <nav aria-label="Edges pagination" className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          disabled={offset === 0}
          aria-label="Previous page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500" aria-live="polite">
          {edges.length > 0 ? `${offset + 1}–${offset + edges.length}` : "0 results"}
        </span>
        <button
          onClick={() => setOffset(offset + LIMIT)}
          disabled={edges.length < LIMIT}
          aria-label="Next page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

function FilterInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-gray-400 mb-1">
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-48"
      />
    </div>
  );
}
