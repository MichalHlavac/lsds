// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type NodeRow } from "../../../lib/api";
import { LifecycleBadge } from "../../../components/LifecycleBadge";

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function NodeDetailPage({ params }: { params: { id: string } }) {
  const [node, setNode] = useState<NodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.nodes
      .get(params.id)
      .then((res) => {
        setNode(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load node");
        setLoading(false);
      });
  }, [params.id]);

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <div className="text-red-400 font-mono text-sm">{error}</div>;
  if (!node) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/nodes" className="text-sm text-gray-500 hover:text-gray-300">
          ← Nodes
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold">{node.name}</h1>
        <LifecycleBadge status={node.lifecycleStatus} />
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
