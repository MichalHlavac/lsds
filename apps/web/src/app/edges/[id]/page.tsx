// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { api, type EdgeRow } from "../../../lib/api";
import { LifecycleBadge } from "../../../components/LifecycleBadge";
import { LifecycleControls } from "../../../components/LifecycleControls";

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString();
}

export default function EdgeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [edge, setEdge] = useState<EdgeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.edges
      .get(id)
      .then((res) => {
        setEdge(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load edge");
        setLoading(false);
      });
  }, [id]);

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (error) return <div className="text-red-400 font-mono text-sm">{error}</div>;
  if (!edge) return null;

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <Link href="/edges" className="text-sm text-gray-500 hover:text-gray-300">
          ← Edges
        </Link>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold font-mono">{edge.type}</h1>
        <LifecycleBadge status={edge.lifecycleStatus} />
        <LifecycleControls
          entityId={edge.id}
          entityType="edge"
          entityName={edge.id}
          currentStatus={edge.lifecycleStatus}
          onSuccess={(updated) => setEdge(updated as EdgeRow)}
        />
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900 divide-y divide-gray-800">
        <Field label="ID">
          <code className="text-xs">{edge.id}</code>
        </Field>
        <Field label="Tenant">
          <code className="text-xs">{edge.tenantId}</code>
        </Field>
        <Field label="Type">
          <code className="text-xs">{edge.type}</code>
        </Field>
        <Field label="Layer">{edge.layer}</Field>
        <Field label="Source">
          <Link
            href={`/nodes/${edge.sourceId}`}
            className="text-blue-400 hover:text-blue-300 font-mono text-xs"
          >
            {edge.sourceId}
          </Link>
        </Field>
        <Field label="Target">
          <Link
            href={`/nodes/${edge.targetId}`}
            className="text-blue-400 hover:text-blue-300 font-mono text-xs"
          >
            {edge.targetId}
          </Link>
        </Field>
        <Field label="Weight">
          <code className="text-xs">{edge.traversalWeight}</code>
        </Field>
        <Field label="Status">
          <LifecycleBadge status={edge.lifecycleStatus} />
        </Field>
        <Field label="Created">{fmt(edge.createdAt)}</Field>
        <Field label="Updated">{fmt(edge.updatedAt)}</Field>
        {edge.deprecatedAt && <Field label="Deprecated">{fmt(edge.deprecatedAt)}</Field>}
        {edge.archivedAt && <Field label="Archived">{fmt(edge.archivedAt)}</Field>}
        {edge.purgeAfter && <Field label="Purge after">{fmt(edge.purgeAfter)}</Field>}
      </div>

      <div className="mt-6">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Attributes
        </h2>
        <pre className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-300 overflow-x-auto">
          {JSON.stringify(edge.attributes, null, 2)}
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
