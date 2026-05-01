// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type ViolationRow, type Severity } from "../../lib/api";
import { SeverityBadge } from "../../components/SeverityBadge";

const SEVERITIES: Severity[] = ["ERROR", "WARN", "INFO"];
const LIMIT = 50;

export default function ViolationsPage() {
  const [violations, setViolations] = useState<ViolationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [ruleKey, setRuleKey] = useState("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [resolved, setResolved] = useState<"" | "false" | "true">("");

  useEffect(() => {
    setLoading(true);
    setError(null);
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
  }, [ruleKey, severity, resolved, offset]);

  function reset() {
    setRuleKey("");
    setSeverity("");
    setResolved("");
    setOffset(0);
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-bold mb-6">Violations</h1>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Rule Key</label>
          <input
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
          <label className="block text-xs text-gray-400 mb-1">Severity</label>
          <select
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
          <label className="block text-xs text-gray-400 mb-1">Status</label>
          <select
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
          onClick={reset}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Severity</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Rule</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Message</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Node</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-red-400 font-mono text-xs">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && violations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                  No violations found.
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              violations.map((v) => (
                <tr
                  key={v.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                >
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
                      <span className="text-gray-600">—</span>
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
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          disabled={offset === 0}
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500">
          {violations.length > 0 ? `${offset + 1}–${offset + violations.length}` : "0 results"}
        </span>
        <button
          onClick={() => setOffset(offset + LIMIT)}
          disabled={violations.length < LIMIT}
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
