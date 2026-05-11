// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState } from "react";
import Link from "next/link";
import { type Layer } from "../lib/api";
import { CreateNodeSchema, UpdateNodeSchema } from "../lib/schemas";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

type FieldErrors = Record<string, string | undefined>;

export type NodeFormValues = {
  name: string;
  type: string;
  layer: Layer;
  version: string;
  attributes: Record<string, unknown>;
};

interface NodeFormProps {
  defaultValues?: Partial<NodeFormValues>;
  onSubmit: (data: NodeFormValues) => Promise<void>;
  isLoading: boolean;
  cancelHref: string;
  submitLabel: string;
  loadingLabel: string;
  serverError?: string | null;
  // When set, type/layer are shown read-only (edit mode)
  readOnlyInfo?: { type: string; layer: string };
}

export function NodeForm({
  defaultValues,
  onSubmit,
  isLoading,
  cancelHref,
  submitLabel,
  loadingLabel,
  serverError,
  readOnlyInfo,
}: NodeFormProps) {
  const [name, setName] = useState(defaultValues?.name ?? "");
  const [type, setType] = useState(defaultValues?.type ?? "");
  const [layer, setLayer] = useState<Layer>(defaultValues?.layer ?? "L1");
  const [version, setVersion] = useState(defaultValues?.version ?? "0.1.0");
  const [attributesJson, setAttributesJson] = useState(
    defaultValues?.attributes ? JSON.stringify(defaultValues.attributes, null, 2) : "{}",
  );
  const [errors, setErrors] = useState<FieldErrors>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});

    let attributes: Record<string, unknown> = {};
    try {
      attributes = JSON.parse(attributesJson) as Record<string, unknown>;
    } catch {
      setErrors({ attributes: "Invalid JSON" });
      return;
    }

    if (readOnlyInfo) {
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
      await onSubmit({ name, type: readOnlyInfo.type, layer: readOnlyInfo.layer as Layer, version, attributes });
    } else {
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
          fe[String(issue.path[0] ?? "root")] = issue.message;
        }
        setErrors(fe);
        return;
      }
      await onSubmit({
        name: result.data.name,
        type: result.data.type,
        layer: result.data.layer,
        version: result.data.version,
        attributes: result.data.attributes,
      });
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {serverError && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {serverError}
        </div>
      )}

      <div>
        <label htmlFor="node-name" className="block text-sm text-gray-400 mb-1">Name</label>
        <input
          id="node-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
      </div>

      {!readOnlyInfo && (
        <>
          <div>
            <label htmlFor="node-type" className="block text-sm text-gray-400 mb-1">
              Type
              <span className="ml-2 text-xs text-gray-500">(freetext — no catalog yet)</span>
            </label>
            <input
              id="node-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
            />
            {errors.type && <p className="mt-1 text-xs text-red-400">{errors.type}</p>}
          </div>

          <div>
            <label htmlFor="node-layer" className="block text-sm text-gray-400 mb-1">Layer</label>
            <select
              id="node-layer"
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
        </>
      )}

      <div>
        <label htmlFor="node-version" className="block text-sm text-gray-400 mb-1">Version</label>
        <input
          id="node-version"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="0.1.0"
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        {errors.version && <p className="mt-1 text-xs text-red-400">{errors.version}</p>}
      </div>

      <div>
        <label htmlFor="node-attributes" className="block text-sm text-gray-400 mb-1">Attributes (JSON)</label>
        <textarea
          id="node-attributes"
          value={attributesJson}
          onChange={(e) => setAttributesJson(e.target.value)}
          rows={readOnlyInfo ? 6 : 4}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        {errors.attributes && <p className="mt-1 text-xs text-red-400">{errors.attributes}</p>}
      </div>

      {readOnlyInfo && (
        <div className="rounded border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-500 space-y-1">
          <div>
            <span className="text-gray-400">Type:</span> {readOnlyInfo.type}
          </div>
          <div>
            <span className="text-gray-400">Layer:</span> {readOnlyInfo.layer}
          </div>
          <div className="text-gray-500">Type and layer are set at creation time.</div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Link
          href={cancelHref}
          className="px-4 py-2 rounded text-sm text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isLoading}
          className="px-4 py-2 rounded text-sm font-medium bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-60"
        >
          {isLoading ? loadingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}
