// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type EdgeRow } from "../../../../lib/api";
import { UpdateEdgeSchema } from "../../../../lib/schemas";

type FieldErrors = Record<string, string | undefined>;

export default function EditEdgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [edge, setEdge] = useState<EdgeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [type, setType] = useState("");
  const [traversalWeight, setTraversalWeight] = useState("1");
  const [attributesJson, setAttributesJson] = useState("{}");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.edges
      .get(id)
      .then((res) => {
        const e = res.data;
        setEdge(e);
        setType(e.type);
        setTraversalWeight(String(e.traversalWeight));
        setAttributesJson(JSON.stringify(e.attributes, null, 2));
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load edge");
        setLoading(false);
      });
  }, [id]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    let attributes: Record<string, unknown> | undefined;
    try {
      attributes = JSON.parse(attributesJson) as Record<string, unknown>;
    } catch {
      setErrors({ attributes: "Invalid JSON" });
      return;
    }

    const weight = parseFloat(traversalWeight);
    const result = UpdateEdgeSchema.safeParse({
      type: type || undefined,
      traversalWeight: isNaN(weight) ? undefined : weight,
      attributes,
    });
    if (!result.success) {
      const fe: FieldErrors = {};
      for (const issue of result.error.issues) {
        fe[String(issue.path[0] ?? "root")] = issue.message;
      }
      setErrors(fe);
      return;
    }

    setSubmitting(true);
    const previous = edge;
    if (edge) setEdge({ ...edge, ...result.data });

    try {
      const res = await api.edges.update(id, result.data);
      setEdge(res.data);
      router.push(`/edges/${id}`);
    } catch (err: unknown) {
      if (previous) setEdge(previous);
      const e = err as { status?: number; body?: { error?: string; issues?: string[] } };
      if (e.status === 422 && e.body) {
        setServerError(e.body.issues?.join("; ") ?? e.body.error ?? "Validation error");
      } else {
        setServerError(err instanceof Error ? err.message : "Unexpected error");
      }
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div role="status" aria-live="polite" className="text-gray-500">
        Loading…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="space-y-3">
        <div role="alert" className="text-red-400 font-mono text-sm">
          {loadError}
        </div>
        <Link href="/edges" className="text-sm text-gray-500 hover:text-gray-300">
          ← Back to edges
        </Link>
      </div>
    );
  }
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

      {serverError && (
        <div
          role="alert"
          className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300"
        >
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="edit-type" className="block text-sm text-gray-400 mb-1">
            Type{" "}
            <span className="ml-2 text-xs text-gray-500">(freetext — no catalog yet)</span>
          </label>
          <input
            id="edit-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-describedby={errors.type ? "edit-type-error" : undefined}
            aria-invalid={!!errors.type}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.type && (
            <p id="edit-type-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.type}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="edit-weight" className="block text-sm text-gray-400 mb-1">
            Traversal Weight
          </label>
          <input
            id="edit-weight"
            type="number"
            step="0.1"
            min="0.1"
            value={traversalWeight}
            onChange={(e) => setTraversalWeight(e.target.value)}
            aria-describedby={errors.traversalWeight ? "edit-weight-error" : undefined}
            aria-invalid={!!errors.traversalWeight}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.traversalWeight && (
            <p id="edit-weight-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.traversalWeight}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="edit-attributes" className="block text-sm text-gray-400 mb-1">
            Attributes (JSON)
          </label>
          <textarea
            id="edit-attributes"
            value={attributesJson}
            onChange={(e) => setAttributesJson(e.target.value)}
            rows={6}
            aria-describedby={errors.attributes ? "edit-attributes-error" : undefined}
            aria-invalid={!!errors.attributes}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.attributes && (
            <p id="edit-attributes-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.attributes}
            </p>
          )}
        </div>

        <div className="rounded border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-500 space-y-1">
          <div>
            <span className="text-gray-400">Source:</span>{" "}
            <span className="font-mono">{edge.sourceId}</span>
          </div>
          <div>
            <span className="text-gray-400">Target:</span>{" "}
            <span className="font-mono">{edge.targetId}</span>
          </div>
          <div>
            <span className="text-gray-400">Layer:</span> {edge.layer}
          </div>
          <div className="text-gray-600">Source, target, and layer are set at creation time.</div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href={`/edges/${id}`}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            aria-busy={submitting}
            className="px-4 py-2 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
