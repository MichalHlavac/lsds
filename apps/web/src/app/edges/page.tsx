// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type EdgeRow } from "../../lib/api";
import { LifecycleBadge } from "../../components/LifecycleBadge";

const LIMIT = 50;

const EDGE_SORT_FIELDS = ["type", "layer", "traversalWeight", "lifecycleStatus"] as const;
type EdgeSortField = (typeof EDGE_SORT_FIELDS)[number];
type SortOrder = "asc" | "desc";

function isEdgeSortField(v: string | null): v is EdgeSortField {
  return EDGE_SORT_FIELDS.includes(v as EdgeSortField);
}

function truncId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

export default function EdgesPage() {
  return (
    <Suspense>
      <EdgesPageInner />
    </Suspense>
  );
}

function EdgesPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [edges, setEdges] = useState<EdgeRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sourceId, setSourceId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [edgeType, setEdgeType] = useState("");
  const [retryCount, setRetryCount] = useState(0);
  const [sortBy, setSortBy] = useState<EdgeSortField | "">(() => {
    const sb = searchParams.get("sortBy");
    return isEdgeSortField(sb) ? sb : "";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder | "">(() => {
    const o = searchParams.get("order");
    return o === "asc" || o === "desc" ? o : "";
  });

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setQ(searchInput);
      setOffset(0);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    api.edges
      .list({
        q: q || undefined,
        sourceId: sourceId || undefined,
        targetId: targetId || undefined,
        type: edgeType || undefined,
        limit: LIMIT,
        offset,
        sortBy: sortBy || undefined,
        order: sortOrder || undefined,
      })
      .then((res) => {
        setEdges(res.data);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load edges");
        setLoading(false);
      });
  }, [q, sourceId, targetId, edgeType, offset, sortBy, sortOrder, retryCount]);

  function handleSort(field: EdgeSortField) {
    let newSortBy: EdgeSortField | "" = field;
    let newOrder: SortOrder | "" = "asc";

    if (sortBy === field) {
      if (sortOrder === "asc") {
        newOrder = "desc";
      } else {
        newSortBy = "";
        newOrder = "";
      }
    }

    setSortBy(newSortBy);
    setSortOrder(newOrder);
    setOffset(0);

    const params = new URLSearchParams(searchParams.toString());
    if (newSortBy) {
      params.set("sortBy", newSortBy);
      params.set("order", newOrder);
    } else {
      params.delete("sortBy");
      params.delete("order");
    }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  function reset() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchInput("");
    setQ("");
    setSourceId("");
    setTargetId("");
    setEdgeType("");
    setOffset(0);
    setSortBy("");
    setSortOrder("");
    router.replace(pathname);
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Edges</h1>
        <Link
          href="/edges/new"
          className="px-3 py-1.5 text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
        >
          + New Edge
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="filter-search" className="block text-xs text-gray-400 mb-1">
            Search
          </label>
          <input
            id="filter-search"
            type="search"
            placeholder="Edge type…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-48"
          />
        </div>
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
          type="button"
          onClick={reset}
          aria-label="Reset filters"
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <SortHeader
                label="Type"
                field="type"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
              <SortHeader
                label="Layer"
                field="layer"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Source → Target
              </th>
              <SortHeader
                label="Weight"
                field="traversalWeight"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
              <SortHeader
                label="Status"
                field="lifecycleStatus"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-gray-500"
                  role="status"
                  aria-live="polite"
                >
                  <span className="inline-block animate-pulse">Loading…</span>
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center" role="alert">
                  <p className="text-red-400 font-mono text-xs mb-3">{error}</p>
                  <button
                    type="button"
                    onClick={() => setRetryCount((c) => c + 1)}
                    className="text-sm text-gray-400 hover:text-gray-100 underline"
                  >
                    Retry
                  </button>
                </td>
              </tr>
            )}
            {!loading && !error && edges.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center">
                  <p className="text-gray-500 mb-2">No edges found.</p>
                  <Link href="/edges/new" className="text-sm text-blue-400 hover:text-blue-300">
                    Create your first edge →
                  </Link>
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
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                    >
                      {edge.type}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300">{edge.layer}</td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 font-mono text-xs">
                      <Link
                        href={`/nodes/${edge.sourceId}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {truncId(edge.sourceId)}
                      </Link>
                      <span className="text-gray-500" aria-hidden="true">
                        →
                      </span>
                      <Link
                        href={`/nodes/${edge.targetId}`}
                        className="text-blue-400 hover:text-blue-300"
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

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          disabled={offset === 0}
          aria-label="Previous page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500" aria-live="polite">
          {edges.length > 0
            ? `${offset + 1}–${offset + edges.length}${total !== null ? ` of ${total}` : ""}`
            : "0 results"}
        </span>
        <button
          type="button"
          onClick={() => setOffset(offset + LIMIT)}
          disabled={edges.length < LIMIT}
          aria-label="Next page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}

function SortHeader({
  label,
  field,
  current,
  order,
  onSort,
}: {
  label: string;
  field: EdgeSortField;
  current: EdgeSortField | "";
  order: SortOrder | "";
  onSort: (f: EdgeSortField) => void;
}) {
  const active = current === field;
  return (
    <th
      scope="col"
      className="text-left px-4 py-2.5 text-gray-400 font-medium"
      aria-sort={active ? (order === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 hover:text-gray-100 transition-colors${active ? " text-gray-100" : ""}`}
      >
        {label}
        <span className={`text-xs select-none ${active ? "text-blue-400" : "text-gray-600"}`}>
          {active ? (order === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
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
