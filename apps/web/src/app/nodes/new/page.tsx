// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type Layer } from "../../../lib/api";
import { CreateNodeSchema } from "../../../lib/schemas";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

type FieldErrors = Record<string, string | undefined>;

export default function CreateNodePage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [layer, setLayer] = useState<Layer>("L1");
  const [version, setVersion] = useState("0.1.0");
  const [attributesJson, setAttributesJson] = useState("{}");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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

    const result = CreateNodeSchema.safeParse({
      type,
      layer,
      name,
      version: version || undefined,
      attributes,
    });
    if (!result.success) {
      const fe: FieldErrors = {};
      for (const issue of result.error.issues) {
        const key = String(issue.path[0] ?? "root");
        fe[key] = issue.message;
      }
      setErrors(fe);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api.nodes.create(result.data);
      router.push(`/nodes/${res.data.id}`);
    } catch (err: unknown) {
      const e = err as { status?: number; body?: { error?: string; issues?: string[] } };
      if (e.status === 422 && e.body) {
        setServerError(e.body.issues?.join("; ") ?? e.body.error ?? "Validation error");
      } else {
        setServerError(err instanceof Error ? err.message : "Unexpected error");
      }
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <Link href="/nodes" className="text-sm text-gray-500 hover:text-gray-300">
          ← Nodes
        </Link>
      </div>
      <h1 className="text-2xl font-bold mb-6">Create Node</h1>

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
          <label htmlFor="node-name" className="block text-sm text-gray-400 mb-1">
            Name <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <input
            id="node-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-describedby={errors.name ? "node-name-error" : undefined}
            aria-invalid={!!errors.name}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.name && (
            <p id="node-name-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.name}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="node-type" className="block text-sm text-gray-400 mb-1">
            Type{" "}
            <span aria-hidden="true" className="text-red-400">*</span>
            <span className="ml-2 text-xs text-gray-500">(freetext — no catalog yet)</span>
          </label>
          <input
            id="node-type"
            required
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-describedby={errors.type ? "node-type-error" : undefined}
            aria-invalid={!!errors.type}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.type && (
            <p id="node-type-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.type}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="node-layer" className="block text-sm text-gray-400 mb-1">
            Layer <span aria-hidden="true" className="text-red-400">*</span>
          </label>
          <select
            id="node-layer"
            required
            value={layer}
            onChange={(e) => setLayer(e.target.value as Layer)}
            aria-describedby={errors.layer ? "node-layer-error" : undefined}
            aria-invalid={!!errors.layer}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          >
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          {errors.layer && (
            <p id="node-layer-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.layer}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="node-version" className="block text-sm text-gray-400 mb-1">
            Version
          </label>
          <input
            id="node-version"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            placeholder="0.1.0"
            aria-describedby={errors.version ? "node-version-error" : undefined}
            aria-invalid={!!errors.version}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.version && (
            <p id="node-version-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.version}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="node-attributes" className="block text-sm text-gray-400 mb-1">
            Attributes (JSON)
          </label>
          <textarea
            id="node-attributes"
            value={attributesJson}
            onChange={(e) => setAttributesJson(e.target.value)}
            rows={4}
            aria-describedby={errors.attributes ? "node-attributes-error" : undefined}
            aria-invalid={!!errors.attributes}
            className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
          />
          {errors.attributes && (
            <p id="node-attributes-error" role="alert" className="mt-1 text-xs text-red-400">
              {errors.attributes}
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Link
            href="/nodes"
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
            {submitting ? "Creating…" : "Create node"}
          </button>
        </div>
      </form>
    </div>
  );
}
