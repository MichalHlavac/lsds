// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type EdgeRow } from "../../../../lib/api";
import { EdgeForm, type EdgeFormValues } from "../../../../components/EdgeForm";

export default function EditEdgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [edge, setEdge] = useState<EdgeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    api.edges
      .get(id)
      .then((res) => {
        setEdge(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load edge");
        setLoading(false);
      });
  }, [id]);

  async function handleSubmit(data: EdgeFormValues) {
    if (!edge) return;
    setServerError(null);
    setSubmitting(true);
    const previous = edge;
    setEdge({ ...edge, type: data.type || edge.type, traversalWeight: data.traversalWeight, attributes: data.attributes });
    try {
      const res = await api.edges.update(id, {
        type: data.type || undefined,
        traversalWeight: data.traversalWeight,
        attributes: data.attributes,
      });
      setEdge(res.data);
      router.push(`/edges/${id}`);
    } catch (err: unknown) {
      setEdge(previous);
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
  if (!edge) return null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={`/edges/${id}`} className="text-sm text-gray-500 hover:text-gray-300">
          ← Edge
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-1">Edit Edge</h1>
      <p className="text-sm text-gray-500 mb-6 font-mono">{edge.id}</p>
      <EdgeForm
        defaultValues={{ type: edge.type, traversalWeight: edge.traversalWeight, attributes: edge.attributes }}
        onSubmit={handleSubmit}
        isLoading={submitting}
        cancelHref={`/edges/${id}`}
        submitLabel="Save changes"
        loadingLabel="Saving…"
        serverError={serverError}
        readOnlyInfo={{ sourceId: edge.sourceId, targetId: edge.targetId, layer: edge.layer }}
      />
    </div>
  );
}
