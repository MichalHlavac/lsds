// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { api, type Layer } from "../../../lib/api";
import { CreateEdgeSchema } from "../../../lib/schemas";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

type FieldErrors = Record<string, string | undefined>;

function CreateEdgeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSourceId = searchParams.get("sourceId") ?? "";

  const [sourceId, setSourceId] = useState(initialSourceId);
  const [targetId, setTargetId] = useState("");
  const [type, setType] = useState("");
  const [layer, setLayer] = useState<Layer>("L1");
  const [traversalWeight, setTraversalWeight] = useState("1");
  const [attributesJson, setAttributesJson] = useState("{}");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const backHref = initialSourceId ? `/nodes/${initialSourceId}` : "/edges";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    let attributes: Record<string, unknown> = {};
    try {
      attributes = JSON.parse(attributesJson) as Record<string, unknown>;
    } catch {
      setErrors({ attributes: "Invalid JSON" });
      return;
    }

    const weight = parseFloat(traversalWeight);
    const result = CreateEdgeSchema.safeParse({
      sourceId,
      targetId,
      type,
      layer,
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
    try {
      const res = await api.edges.create(result.data);
      router.push(`/edges/${res.data.id}`);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: { error?: string; issues?: string[] } };
      if (e.status === 422 && e.body) {
        const detail = e.body.issues?.join("; ") ?? e.body.error ?? "Validation error";
        setServerError(detail);
      } else {
        setServerError(err instanceof Error ? err.message : "Unexpected error");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href={backHref} className="text-sm text-gray-500 hover:text-gray-300">
          ← {initialSourceId ? "Node" : "Edges"}
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create Edge</h1>

      {serverError && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Source Node ID</label>
          <input
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            placeholder="UUID"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.sourceId && <p className="mt-1 text-xs text-red-400">{errors.sourceId}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Target Node ID</label>
          <input
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder="UUID"
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.targetId && <p className="mt-1 text-xs text-red-400">{errors.targetId}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Type
            <span className="ml-2 text-xs text-gray-500">(freetext — no catalog yet)</span>
          </label>
          <input
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.type && <p className="mt-1 text-xs text-red-400">{errors.type}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Layer</label>
          <select
            value={layer}
            onChange={(e) => setLayer(e.target.value as Layer)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {errors.layer && <p className="mt-1 text-xs text-red-400">{errors.layer}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Traversal Weight</label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            value={traversalWeight}
            onChange={(e) => setTraversalWeight(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.traversalWeight && (
            <p className="mt-1 text-xs text-red-400">{errors.traversalWeight}</p>
          )}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Attributes (JSON)</label>
          <textarea
            value={attributesJson}
            onChange={(e) => setAttributesJson(e.target.value)}
            rows={4}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.attributes && <p className="mt-1 text-xs text-red-400">{errors.attributes}</p>}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href={backHref}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60"
          >
            {submitting ? "Creating…" : "Create edge"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CreateEdgePage() {
  return (
    <Suspense fallback={<div className="text-gray-500">Loading…</div>}>
      <CreateEdgeForm />
    </Suspense>
  );
}
