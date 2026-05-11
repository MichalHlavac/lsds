// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  api,
  type NodeRow,
  type Layer,
  type LifecycleStatus,
  type LifecycleTransition,
  type BatchFailedItem,
} from "../../lib/api";
import { LifecycleBadge } from "../../components/LifecycleBadge";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];
const STATUSES: LifecycleStatus[] = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"];
const TRANSITIONS: { value: LifecycleTransition; label: string }[] = [
  { value: "deprecate", label: "Deprecate" },
  { value: "archive", label: "Archive" },
  { value: "purge", label: "Purge" },
];
const LIMIT = 50;

interface BulkResult {
  succeededCount: number;
  failed: BatchFailedItem[];
}

const NODE_SORT_FIELDS = ["name", "type", "layer", "lifecycleStatus", "createdAt"] as const;
type NodeSortField = (typeof NODE_SORT_FIELDS)[number];
type SortOrder = "asc" | "desc";

function isNodeSortField(v: string | null): v is NodeSortField {
  return NODE_SORT_FIELDS.includes(v as NodeSortField);
}

export default function NodesPage() {
  return (
    <Suspense>
      <NodesPageInner />
    </Suspense>
  );
}

function NodesPageInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [layer, setLayer] = useState<Layer | "">("");
  const [nodeType, setNodeType] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | "">("");
  const [retryCount, setRetryCount] = useState(0);
  const [sortBy, setSortBy] = useState<NodeSortField | "">(() => {
    const sb = searchParams.get("sortBy");
    return isNodeSortField(sb) ? sb : "";
  });
  const [sortOrder, setSortOrder] = useState<SortOrder | "">(() => {
    const o = searchParams.get("order");
    return o === "asc" || o === "desc" ? o : "";
  });

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk action state
  const [bulkTransition, setBulkTransition] = useState<LifecycleTransition>("deprecate");
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

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
    setSelected(new Set());
    api.nodes
      .list({
        q: q || undefined,
        layer: layer || undefined,
        type: nodeType || undefined,
        lifecycleStatus: status || undefined,
        limit: LIMIT,
        offset,
        sortBy: sortBy || undefined,
        order: sortOrder || undefined,
      })
      .then((res) => {
        setNodes(res.data);
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load nodes");
        setLoading(false);
      });
  }, [q, layer, nodeType, status, offset, sortBy, sortOrder, retryCount]);

  function handleSort(field: NodeSortField) {
    let newSortBy: NodeSortField | "" = field;
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
    setLayer("");
    setNodeType("");
    setStatus("");
    setOffset(0);
    setSortBy("");
    setSortOrder("");
    router.replace(pathname);
  }

  const allSelected = nodes.length > 0 && nodes.every((n) => selected.has(n.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(nodes.map((n) => n.id)));
    }
  }

  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openBulkModal() {
    setBulkResult(null);
    setShowBulkModal(true);
  }

  function closeBulkModal() {
    if (bulkPending) return;
    setShowBulkModal(false);
    setBulkResult(null);
  }

  async function handleBulkConfirm() {
    setBulkPending(true);
    try {
      const res = await api.nodes.batchLifecycle([...selected], bulkTransition);
      const { succeeded, failed } = res.data;
      if (failed.length === 0) {
        setShowBulkModal(false);
        const count = succeeded.length;
        showToast(`${count} node${count !== 1 ? "s" : ""} ${bulkTransition}d successfully.`);
        setNodes((prev) =>
          prev.map((n) => {
            const updated = succeeded.find((s) => s.id === n.id);
            return updated ?? n;
          }),
        );
        setSelected(new Set());
      } else {
        setBulkResult({ succeededCount: succeeded.length, failed });
        setNodes((prev) =>
          prev.map((n) => {
            const updated = succeeded.find((s) => s.id === n.id);
            return updated ?? n;
          }),
        );
        setSelected(new Set(failed.map((f) => f.id)));
      }
    } catch (err: unknown) {
      setShowBulkModal(false);
      showToast(err instanceof Error ? err.message : "Bulk operation failed.");
    } finally {
      setBulkPending(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const isPurge = bulkTransition === "purge";
  const colSpan = 7;

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Nodes</h1>
        <Link
          href="/nodes/new"
          className="px-3 py-1.5 text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
        >
          + New Node
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
            placeholder="Name or type…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-48"
          />
        </div>
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
          type="button"
          onClick={reset}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
          aria-label="Reset filters"
        >
          Reset
        </button>
      </div>

      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-blue-700 bg-blue-950/40 px-4 py-2.5">
          <span className="text-sm text-blue-300 font-medium">
            {selected.size} node{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <label htmlFor="bulk-transition" className="text-xs text-gray-400">
              Transition:
            </label>
            <select
              id="bulk-transition"
              value={bulkTransition}
              onChange={(e) => setBulkTransition(e.target.value as LifecycleTransition)}
              className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
            >
              {TRANSITIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={openBulkModal}
              className="px-3 py-1.5 text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white rounded transition-colors"
            >
              Apply to {selected.size}
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-gray-800 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th scope="col" className="px-4 py-2.5 w-10">
                <input
                  type="checkbox"
                  aria-label="Select all nodes on this page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  disabled={loading || nodes.length === 0}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                />
              </th>
              <SortHeader
                label="Name"
                field="name"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
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
                Version
              </th>
              <SortHeader
                label="Status"
                field="lifecycleStatus"
                current={sortBy}
                order={sortOrder}
                onSort={handleSort}
              />
              <SortHeader
                label="Created"
                field="createdAt"
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
                  colSpan={colSpan}
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
                <td colSpan={colSpan} className="px-4 py-8 text-center" role="alert">
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
            {!loading && !error && nodes.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center">
                  <p className="text-gray-500 mb-2">No nodes found.</p>
                  <Link href="/nodes/new" className="text-sm text-blue-400 hover:text-blue-300">
                    Create your first node →
                  </Link>
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              nodes.map((node) => (
                <tr
                  key={node.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                  aria-selected={selected.has(node.id)}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${node.name}`}
                      checked={selected.has(node.id)}
                      onChange={() => toggleRow(node.id)}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/nodes/${node.id}`}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {node.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{node.type}</td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/layers/${node.layer.toLowerCase()}`}
                      className="text-blue-400 hover:text-blue-300 font-mono"
                    >
                      {node.layer}
                    </Link>
                  </td>
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
          {nodes.length > 0
            ? `${offset + 1}–${offset + nodes.length}${total !== null ? ` of ${total}` : ""}`
            : "0 results"}
        </span>
        <button
          type="button"
          onClick={() => setOffset(offset + LIMIT)}
          disabled={nodes.length < LIMIT}
          aria-label="Next page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      {/* Bulk lifecycle confirmation modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeBulkModal();
          }}
        >
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-100 mb-1">
              Confirm bulk {bulkTransition}
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Apply <span className="font-semibold text-gray-200">{bulkTransition}</span> to{" "}
              <span className="font-semibold text-gray-200">{selected.size}</span> node
              {selected.size !== 1 ? "s" : ""}.
            </p>

            {isPurge && (
              <div className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300">
                Purge cannot be undone.
              </div>
            )}

            {/* Partial-success result */}
            {bulkResult && (
              <div className="mb-4 rounded border border-yellow-700 bg-yellow-950/40 px-3 py-3 text-sm">
                {bulkResult.succeededCount > 0 && (
                  <p className="text-green-300 mb-2">
                    ✓ {bulkResult.succeededCount} node
                    {bulkResult.succeededCount !== 1 ? "s" : ""} transitioned.
                  </p>
                )}
                <p className="text-yellow-300 font-medium mb-1">
                  {bulkResult.failed.length} failed:
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {bulkResult.failed.map((f) => (
                    <li key={f.id} className="text-yellow-200 font-mono text-xs">
                      {f.id.slice(0, 8)}… — {f.error}
                      {f.currentStatus && (
                        <span className="text-yellow-400">
                          {" "}
                          (current: {f.currentStatus}, allowed:{" "}
                          {f.allowed?.join(", ") ?? "none"})
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6">
              <button
                type="button"
                onClick={closeBulkModal}
                disabled={bulkPending}
                className="px-3 py-1.5 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 disabled:opacity-50"
              >
                {bulkResult ? "Close" : "Cancel"}
              </button>
              {!bulkResult && (
                <button
                  type="button"
                  onClick={handleBulkConfirm}
                  disabled={bulkPending}
                  className={`px-3 py-1.5 rounded text-sm font-medium text-white transition-colors disabled:opacity-60 ${
                    isPurge
                      ? "bg-red-700 hover:bg-red-600"
                      : "bg-blue-700 hover:bg-blue-600"
                  }`}
                >
                  {bulkPending
                    ? `${bulkTransition.charAt(0).toUpperCase() + bulkTransition.slice(1)}ing…`
                    : `${bulkTransition.charAt(0).toUpperCase() + bulkTransition.slice(1)} ${selected.size}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg border border-green-700 bg-green-950 px-4 py-3 text-sm text-green-300 shadow-xl">
          {toast}
        </div>
      )}
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
  field: NodeSortField;
  current: NodeSortField | "";
  order: SortOrder | "";
  onSort: (f: NodeSortField) => void;
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
        <span aria-hidden="true" className={`text-xs select-none ${active ? "text-blue-400" : "text-gray-400"}`}>
          {active ? (order === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}
