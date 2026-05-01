// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ViolationRow, type Severity } from "../../lib/api";
import { SeverityBadge } from "../../components/SeverityBadge";

const SEVERITIES: Severity[] = ["ERROR", "WARN", "INFO"];
const LIMIT = 50;

interface ResolveFailedItem {
  id: string;
  error: string;
}

interface BulkResolveResult {
  succeededCount: number;
  failed: ResolveFailedItem[];
}

export default function ViolationsPage() {
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [ruleKey, setRuleKey] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [resolved, setResolved] = useState<"" | "false" | "true">("");
  const [retryCount, setRetryCount] = useState(0);

  // Selection state
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Bulk resolve state
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkResult, setBulkResult] = useState<BulkResolveResult | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelected(new Set());
    api.violations
      .list({
        ruleKey: ruleKey || undefined,
        resolved: resolved === "" ? undefined : resolved === "true",
        limit: LIMIT,
        offset,
      })
      .then((res) => {
        const rows = severity
          ? res.data.filter((v) => v.severity === severity)
          : res.data;
        setViolations(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load violations");
        setLoading(false);
      });
  }, [ruleKey, severity, resolved, offset, retryCount]);

  function reset() {
    setRuleKey("");
    setSeverity("");
    setResolved("");
    setOffset(0);
  }

  const allSelected = violations.length > 0 && violations.every((v) => selected.has(v.id));
  const someSelected = selected.size > 0 && !allSelected;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(violations.map((v) => v.id)));
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
      const res = await api.violations.batchResolve([...selected]);
      const { succeeded, failed } = res.data;
      if (failed.length === 0) {
        setShowBulkModal(false);
        const count = succeeded.length;
        showToast(`${count} violation${count !== 1 ? "s" : ""} resolved.`);
        const resolvedIds = new Set(succeeded.map((v) => v.id));
        setViolations((prev) =>
          prev.map((v) => (resolvedIds.has(v.id) ? { ...v, resolved: true } : v)),
        );
        setSelected(new Set());
      } else {
        setBulkResult({ succeededCount: succeeded.length, failed });
        const resolvedIds = new Set(succeeded.map((v) => v.id));
        setViolations((prev) =>
          prev.map((v) => (resolvedIds.has(v.id) ? { ...v, resolved: true } : v)),
        );
        setSelected(new Set(failed.map((f) => f.id)));
      }
    } catch (err: unknown) {
      setShowBulkModal(false);
      showToast(err instanceof Error ? err.message : "Bulk resolve failed.");
    } finally {
      setBulkPending(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const colSpan = 7;

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Violations</h1>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="filter-rule" className="block text-xs text-gray-400 mb-1">
            Rule Key
          </label>
          <input
            id="filter-rule"
            type="text"
            placeholder="e.g. no-orphan-node"
            value={ruleKey}
            onChange={(e) => setRuleKey(e.target.value)}
            onBlur={() => setOffset(0)}
            onKeyDown={(e) => e.key === "Enter" && setOffset(0)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-48"
          />
        </div>
        <div>
          <label htmlFor="filter-severity" className="block text-xs text-gray-400 mb-1">
            Severity
          </label>
          <select
            id="filter-severity"
            value={severity}
            onChange={(e) => {
              setSeverity(e.target.value as Severity | "");
              setOffset(0);
            }}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
          >
            <option value="">All severities</option>
            {SEVERITIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filter-resolved" className="block text-xs text-gray-400 mb-1">
            Status
          </label>
          <select
            id="filter-resolved"
            value={resolved}
            onChange={(e) => {
              setResolved(e.target.value as "" | "false" | "true");
              setOffset(0);
            }}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
          >
            <option value="">All</option>
            <option value="false">Unresolved</option>
            <option value="true">Resolved</option>
          </select>
        </div>
        <button
          type="button"
          onClick={reset}
          aria-label="Reset filters"
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      {/* Bulk actions toolbar */}
      {selected.size > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-lg border border-blue-700 bg-blue-950/40 px-4 py-2.5">
          <span className="text-sm text-blue-300 font-medium">
            {selected.size} violation{selected.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={openBulkModal}
              className="px-3 py-1.5 text-sm font-medium bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
            >
              Resolve selected ({selected.size})
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
                  aria-label="Select all violations on this page"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  disabled={loading || violations.length === 0}
                  className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                />
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Severity
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Rule
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Message
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Node
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Status
              </th>
              <th scope="col" className="text-left px-4 py-2.5 text-gray-400 font-medium">
                Created
              </th>
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
            {!loading && !error && violations.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-10 text-center">
                  <p className="text-gray-500">
                    {ruleKey || severity || resolved
                      ? "No violations match the current filters."
                      : "No violations — the graph is clean."}
                  </p>
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              violations.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                  aria-selected={selected.has(v.id)}
                >
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select violation ${v.ruleKey}`}
                      checked={selected.has(v.id)}
                      onChange={() => toggleRow(v.id)}
                      className="rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-950"
                    />
                  </td>
                  <td className="px-4 py-2.5">
                    <SeverityBadge severity={v.severity} />
                  </td>
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/violations/${v.id}`}
                      className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                    >
                      {v.ruleKey}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 max-w-xs truncate">{v.message}</td>
                  <td className="px-4 py-2.5">
                    {v.nodeId ? (
                      <Link
                        href={`/nodes/${v.nodeId}`}
                        className="text-blue-400 hover:text-blue-300 font-mono text-xs"
                      >
                        {v.nodeId.slice(0, 8)}…
                      </Link>
                    ) : (
                      <span className="text-gray-600" aria-label="No node">
                        —
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {v.resolved ? (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-green-900/50 text-green-300 ring-1 ring-green-700">
                        Resolved
                      </span>
                    ) : (
                      <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-gray-800 text-gray-400 ring-1 ring-gray-600">
                        Open
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {new Date(v.createdAt).toLocaleDateString()}
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
          {violations.length > 0
            ? `${offset + 1}–${offset + violations.length}`
            : "0 results"}
        </span>
        <button
          type="button"
          onClick={() => setOffset(offset + LIMIT)}
          disabled={violations.length < LIMIT}
          aria-label="Next page"
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>

      {/* Bulk resolve confirmation modal */}
      {showBulkModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeBulkModal();
          }}
        >
          <div className="w-full max-w-lg rounded-lg border border-gray-700 bg-gray-900 p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-100 mb-1">
              Confirm bulk resolve
            </h2>
            <p className="text-sm text-gray-400 mb-4">
              Mark{" "}
              <span className="font-semibold text-gray-200">{selected.size}</span> violation
              {selected.size !== 1 ? "s" : ""} as resolved.
            </p>

            {/* Partial-success result */}
            {bulkResult && (
              <div className="mb-4 rounded border border-yellow-700 bg-yellow-950/40 px-3 py-3 text-sm">
                {bulkResult.succeededCount > 0 && (
                  <p className="text-green-300 mb-2">
                    ✓ {bulkResult.succeededCount} violation
                    {bulkResult.succeededCount !== 1 ? "s" : ""} resolved.
                  </p>
                )}
                <p className="text-yellow-300 font-medium mb-1">
                  {bulkResult.failed.length} failed:
                </p>
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {bulkResult.failed.map((f) => (
                    <li key={f.id} className="text-yellow-200 font-mono text-xs">
                      {f.id.slice(0, 8)}… — {f.error}
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
                  className="px-3 py-1.5 rounded text-sm font-medium text-white bg-green-700 hover:bg-green-600 transition-colors disabled:opacity-60"
                >
                  {bulkPending
                    ? "Resolving…"
                    : `Resolve ${selected.size}`}
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
