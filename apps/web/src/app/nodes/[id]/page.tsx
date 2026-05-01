// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type NodeRow, type NodeHistoryEntry, type HistoryOp } from "../../../lib/api";
import { LifecycleBadge } from "../../../components/LifecycleBadge";
import { LifecycleControls } from "../../../components/LifecycleControls";

const OP_LABELS: Record<HistoryOp, string> = {
  CREATE: "Created",
  UPDATE: "Updated",
  LIFECYCLE_TRANSITION: "Lifecycle",
};

const OP_COLORS: Record<HistoryOp, string> = {
  CREATE: "bg-green-900 text-green-300",
  UPDATE: "bg-blue-900 text-blue-300",
  LIFECYCLE_TRANSITION: "bg-yellow-900 text-yellow-300",
};

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function NodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [node, setNode] = useState<NodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<NodeHistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);

  useEffect(() => {
    api.nodes
      .get(id)
      .then((res) => {
        setNode(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load node");
        setLoading(false);
      });
    setHistoryLoading(true);
    api.nodes
      .history(id, { limit: 20 })
      .then((res) => setHistory(res.data))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="text-gray-500">
        Loading…
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3">
        <div role="alert" className="text-red-400 font-mono text-sm">
          {error}
        </div>
        <Link href="/nodes" className="text-sm text-gray-500 hover:text-gray-300">
          ← Back to nodes
        </Link>
      </div>
    );
  }
  if (!node) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/nodes" className="text-sm text-gray-500 hover:text-gray-300">
          ← Nodes
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <h1 className="text-2xl font-bold">{node.name}</h1>
        <LifecycleBadge status={node.lifecycleStatus} />
        <div className="flex items-center gap-2 ml-auto">
          <Link
            href={`/edges/new?sourceId=${node.id}`}
            className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
          >
            + Add Edge
          </Link>
          <Link
            href={`/nodes/${node.id}/edit`}
            className="px-3 py-1.5 rounded text-sm font-medium bg-gray-700 hover:bg-gray-600 text-white transition-colors"
          >
            Edit
          </Link>
          <LifecycleControls
            entityId={node.id}
            entityType="node"
            entityName={node.name}
            currentStatus={node.lifecycleStatus}
            onSuccess={(updated) => setNode(updated as NodeRow)}
          />
        </div>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800">
        <Field label="ID">
          <code className="text-xs">{node.id}</code>
        </Field>
        <Field label="Tenant">
          <code className="text-xs">{node.tenantId}</code>
        </Field>
        <Field label="Type">
          <code className="text-xs">{node.type}</code>
        </Field>
        <Field label="Layer">{node.layer}</Field>
        <Field label="Version">
          <code className="text-xs">{node.version}</code>
        </Field>
        <Field label="Status">
          <LifecycleBadge status={node.lifecycleStatus} />
        </Field>
        <Field label="Created">{fmt(node.createdAt)}</Field>
        <Field label="Updated">{fmt(node.updatedAt)}</Field>
        {node.deprecatedAt && <Field label="Deprecated">{fmt(node.deprecatedAt)}</Field>}
        {node.archivedAt && <Field label="Archived">{fmt(node.archivedAt)}</Field>}
        {node.purgeAfter && <Field label="Purge after">{fmt(node.purgeAfter)}</Field>}
      </div>

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Attributes
        </h2>
        <pre className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-300 overflow-x-auto">
          {JSON.stringify(node.attributes, null, 2)}
        </pre>
      </div>

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Change History
        </h2>
        {historyLoading && (
          <p className="text-gray-500 text-sm">Loading history…</p>
        )}
        {!historyLoading && history.length === 0 && (
          <p className="text-gray-600 text-sm">No history recorded yet.</p>
        )}
        {!historyLoading && history.length > 0 && (
          <ol className="space-y-2">
            {history.map((entry) => (
              <li key={entry.id} className="rounded-lg border border-gray-800 bg-gray-900">
                <button
                  type="button"
                  onClick={() => setExpandedEntry(expandedEntry === entry.id ? null : entry.id)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-gray-800 transition-colors rounded-lg"
                >
                  <span
                    className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded ${OP_COLORS[entry.op]}`}
                  >
                    {OP_LABELS[entry.op]}
                  </span>
                  <span className="text-sm text-gray-300 flex-1 truncate">
                    {new Date(entry.changedAt).toLocaleString()}
                  </span>
                  {entry.changedBy && (
                    <span className="text-xs text-gray-500 font-mono shrink-0">{entry.changedBy}</span>
                  )}
                  <span className="text-gray-600 text-xs shrink-0">
                    {expandedEntry === entry.id ? "▲" : "▼"}
                  </span>
                </button>
                {expandedEntry === entry.id && (
                  <div className="px-4 pb-3 grid grid-cols-2 gap-3">
                    {entry.previous !== null && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1 font-medium">Before</p>
                        <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 overflow-x-auto">
                          {JSON.stringify(entry.previous, null, 2)}
                        </pre>
                      </div>
                    )}
                    <div className={entry.previous === null ? "col-span-2" : ""}>
                      <p className="text-xs text-gray-500 mb-1 font-medium">After</p>
                      <pre className="text-xs text-gray-300 bg-gray-950 rounded p-2 overflow-x-auto">
                        {JSON.stringify(entry.current, null, 2)}
                      </pre>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-3 gap-4">
      <span className="w-28 shrink-0 text-sm text-gray-400">{label}</span>
      <span className="text-sm text-gray-100">{children}</span>
    </div>
  );
}
