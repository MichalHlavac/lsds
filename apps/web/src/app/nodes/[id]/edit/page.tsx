// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type NodeRow } from "../../../../lib/api";
import { UpdateNodeSchema } from "../../../../lib/schemas";

type FieldErrors = Record<string, string | undefined>;

export default function EditNodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [node, setNode] = useState<NodeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [attributesJson, setAttributesJson] = useState("{}");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.nodes
      .get(id)
      .then((res) => {
        const n = res.data;
        setNode(n);
        setName(n.name);
        setVersion(n.version);
        setAttributesJson(JSON.stringify(n.attributes, null, 2));
        setLoading(false);
      })
      .catch((err: unknown) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load node");
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

    const result = UpdateNodeSchema.safeParse({
      name: name || undefined,
      version: version || undefined,
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
    // optimistic update
    if (node) setNode({ ...node, ...result.data });

    try {
      const res = await api.nodes.update(id, result.data);
      setNode(res.data);
      router.push(`/nodes/${id}`);
    } catch (err: unknown) {
      // rollback
      if (node) setNode(node);
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

      {serverError && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {serverError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Version</label>
          <input
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.version && <p className="mt-1 text-xs text-red-400">{errors.version}</p>}
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Attributes (JSON)</label>
          <textarea
            value={attributesJson}
            onChange={(e) => setAttributesJson(e.target.value)}
            rows={6}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.attributes && <p className="mt-1 text-xs text-red-400">{errors.attributes}</p>}
        </div>

        <div className="rounded border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-500 space-y-1">
          <div>
            <span className="text-gray-400">Type:</span> {node.type}
          </div>
          <div>
            <span className="text-gray-400">Layer:</span> {node.layer}
          </div>
          <div className="text-gray-600">Type and layer are set at creation time.</div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href={`/nodes/${id}`}
            className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60"
          >
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
