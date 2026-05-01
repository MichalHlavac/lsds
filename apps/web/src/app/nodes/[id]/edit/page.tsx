// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type NodeRow } from "../../../../lib/api";
import { NodeForm, type NodeFormValues } from "../../../../components/NodeForm";

export default function EditNodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [node, setNode] = useState<NodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    api.nodes
      .get(id)
      .then((res) => {
        setNode(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load node");
        setLoading(false);
      });
  }, [id]);

  async function handleSubmit(data: NodeFormValues) {
    if (!node) return;
    setServerError(null);
    setSubmitting(true);
    const previous = node;
    setNode({ ...node, name: data.name || node.name, version: data.version || node.version, attributes: data.attributes });
    try {
      const res = await api.nodes.update(id, {
        name: data.name || undefined,
        version: data.version || undefined,
        attributes: data.attributes,
      });
      setNode(res.data);
      router.push(`/nodes/${id}`);
    } catch (err: unknown) {
      setNode(previous);
      const e = err as { status?: number; body?: { error?: string; issues?: string[] } };
      if (e.status === 422 && e.body) {
        setServerError(e.body.issues?.join("; ") ?? e.body.error ?? "Validation error");
      } else {
        setServerError(err instanceof Error ? err.message : "Unexpected error");
      }
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-gray-500">Loading…</div>;
  if (loadError) return <div className="text-red-400 font-mono text-sm">{loadError}</div>;
  if (!node) return null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={`/nodes/${id}`} className="text-sm text-gray-500 hover:text-gray-300">
          ← {node.name}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">Edit Node</h1>
      <p className="text-sm text-gray-500 mb-6 font-mono">{node.id}</p>
      <NodeForm
        defaultValues={{ name: node.name, version: node.version, attributes: node.attributes }}
        onSubmit={handleSubmit}
        isLoading={submitting}
        cancelHref={`/nodes/${id}`}
        submitLabel="Save changes"
        loadingLabel="Saving…"
        serverError={serverError}
        readOnlyInfo={{ type: node.type, layer: node.layer }}
      />
    </div>
  );
}
