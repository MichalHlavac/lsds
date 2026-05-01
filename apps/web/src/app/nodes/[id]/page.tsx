// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { api, type NodeRow } from "../../../lib/api";
import { LifecycleBadge } from "../../../components/LifecycleBadge";
import { LifecycleControls } from "../../../components/LifecycleControls";

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function NodeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [node, setNode] = useState<NodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
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
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-500" aria-live="polite">
        <span className="h-4 w-4 rounded-full border-2 border-gray-600 border-t-gray-300 animate-spin" aria-hidden="true" />
        Loading node…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-red-400 font-mono text-sm">{error}</p>
        <button
          onClick={load}
          className="text-sm text-gray-400 underline hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!node) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link
          href="/nodes"
          className="text-sm text-gray-500 hover:text-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 rounded"
          aria-label="Back to nodes list"
        >
          ← Nodes
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{node.name}</h1>
        <LifecycleBadge status={node.lifecycleStatus} />
        <LifecycleControls
          entityId={node.id}
          entityType="node"
          entityName={node.name}
          currentStatus={node.lifecycleStatus}
          onSuccess={(updated) => setNode(updated as NodeRow)}
        />
      </div>

      <dl className="rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800">
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
      </dl>

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Attributes
        </h2>
        <pre className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-300 overflow-x-auto">
          {JSON.stringify(node.attributes, null, 2)}
        </pre>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex px-4 py-3 gap-4">
      <dt className="w-28 shrink-0 text-sm text-gray-400">{label}</dt>
      <dd className="text-sm text-gray-100">{children}</dd>
    </div>
  );
}
