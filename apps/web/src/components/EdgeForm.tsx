// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useState } from "react";
import Link from "next/link";
import { type Layer } from "../lib/api";
import { CreateEdgeSchema, UpdateEdgeSchema } from "../lib/schemas";
import { NodeCombobox } from "./NodeCombobox";

const LAYERS: Layer[] = ["L1", "L2", "L3", "L4", "L5", "L6"];

type FieldErrors = Record<string, string | undefined>;

export type EdgeFormValues = {
  sourceId: string;
  targetId: string;
  type: string;
  layer: Layer;
  traversalWeight: number;
  attributes: Record<string, unknown>;
};

interface EdgeFormProps {
  defaultValues?: Partial<EdgeFormValues>;
  onSubmit: (data: EdgeFormValues) => Promise<void>;
  isLoading: boolean;
  cancelHref: string;
  submitLabel: string;
  loadingLabel: string;
  serverError?: string | null;
  // When set, source/target/layer are shown read-only (edit mode)
  readOnlyInfo?: { sourceId: string; targetId: string; layer: string };
}

export function EdgeForm({
  defaultValues,
  onSubmit,
  isLoading,
  cancelHref,
  submitLabel,
  loadingLabel,
  serverError,
  readOnlyInfo,
}: EdgeFormProps) {
  const [sourceId, setSourceId] = useState(defaultValues?.sourceId ?? "");
  const [targetId, setTargetId] = useState(defaultValues?.targetId ?? "");
  const [type, setType] = useState(defaultValues?.type ?? "");
  const [layer, setLayer] = useState<Layer>(defaultValues?.layer ?? "L1");
  const [traversalWeight, setTraversalWeight] = useState(
    defaultValues?.traversalWeight !== undefined ? String(defaultValues.traversalWeight) : "1",
  );
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

    const weight = parseFloat(traversalWeight);

    if (readOnlyInfo) {
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
      await onSubmit({
        sourceId: readOnlyInfo.sourceId,
        targetId: readOnlyInfo.targetId,
        type,
        layer: readOnlyInfo.layer as Layer,
        traversalWeight: isNaN(weight) ? 1 : weight,
        attributes,
      });
    } else {
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
      await onSubmit({
        sourceId: result.data.sourceId,
        targetId: result.data.targetId,
        type: result.data.type,
        layer: result.data.layer,
        traversalWeight: result.data.traversalWeight,
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

      {!readOnlyInfo && (
        <>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Source Node</label>
            <NodeCombobox
              value={sourceId}
              onChange={setSourceId}
              placeholder="Search source node…"
              error={errors.sourceId}
            />
            {errors.sourceId && <p className="mt-1 text-xs text-red-400">{errors.sourceId}</p>}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Target Node</label>
            <NodeCombobox
              value={targetId}
              onChange={setTargetId}
              placeholder="Search target node…"
              error={errors.targetId}
            />
            {errors.targetId && <p className="mt-1 text-xs text-red-400">{errors.targetId}</p>}
          </div>
        </>
      )}

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

      {!readOnlyInfo && (
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
      )}

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
          rows={readOnlyInfo ? 6 : 4}
          className="w-full rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono text-gray-100 focus:border-blue-500 focus:outline-none"
        />
        {errors.attributes && <p className="mt-1 text-xs text-red-400">{errors.attributes}</p>}
      </div>

      {readOnlyInfo && (
        <div className="rounded border border-gray-800 bg-gray-900/50 px-4 py-3 text-xs text-gray-500 space-y-1">
          <div>
            <span className="text-gray-400">Source:</span>{" "}
            <span className="font-mono">{readOnlyInfo.sourceId}</span>
          </div>
          <div>
            <span className="text-gray-400">Target:</span>{" "}
            <span className="font-mono">{readOnlyInfo.targetId}</span>
          </div>
          <div>
            <span className="text-gray-400">Layer:</span> {readOnlyInfo.layer}
          </div>
          <div className="text-gray-600">Source, target, and layer are set at creation time.</div>
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
