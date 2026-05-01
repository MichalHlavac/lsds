// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { LAYER_IDS } from "@lsds/shared";
import { api, type NodeRow, type Layer, type LifecycleStatus } from "../../../lib/api";
import { LifecycleBadge } from "../../../components/LifecycleBadge";

const STATUSES: LifecycleStatus[] = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"];
const LIMIT = 50;

export default function LayerDetailPage({ params }: { params: Promise<{ layer: string }> }) {
  const { layer: slug } = use(params);
  const layer = slug.toUpperCase() as Layer;
  const isValid = (LAYER_IDS as readonly string[]).includes(layer);

  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [nodeType, setNodeType] = useState("");
  const [status, setStatus] = useState<LifecycleStatus | "">("");

  useEffect(() => {
    if (!isValid) return;
    setLoading(true);
    setError(null);
    api.layers
      .getNodes(layer, {
        type: nodeType || undefined,
        lifecycleStatus: status || undefined,
        limit: LIMIT,
        offset,
      })
      .then((res) => {
        setNodes(res.data);
        setLoading(false);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load nodes");
        setLoading(false);
      });
  }, [layer, isValid, nodeType, status, offset]);

  if (!isValid) {
    return (
      <div className="max-w-6xl">
        <p className="text-red-400">Invalid layer: {slug}</p>
      </div>
    );
  }

  function reset() {
    setNodeType("");
    setStatus("");
    setOffset(0);
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <Link href="/layers" className="text-xs text-gray-500 hover:text-gray-300 mb-2 block">
          ← Layers
        </Link>
        <h1 className="text-2xl font-bold">Layer {layer}</h1>
      </div>

      <div className="mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-400 mb-1">Type</label>
          <input
            type="text"
            placeholder="e.g. Service"
            value={nodeType}
            onChange={(e) => setNodeType(e.target.value)}
            onBlur={() => setOffset(0)}
            onKeyDown={(e) => e.key === "Enter" && setOffset(0)}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 placeholder-gray-600 focus:outline-none focus:border-gray-500 w-40"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as LifecycleStatus | "");
              setOffset(0);
            }}
            className="bg-gray-900 border border-gray-700 rounded px-3 py-1.5 text-sm text-gray-100 focus:outline-none focus:border-gray-500"
          >
            <option value="">All statuses</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={reset}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-100 border border-gray-700 rounded hover:border-gray-500 transition-colors"
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Name</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Type</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Version</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Status</th>
              <th className="text-left px-4 py-2.5 text-gray-400 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  Loading…
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-red-400 font-mono text-xs">
                  {error}
                </td>
              </tr>
            )}
            {!loading && !error && nodes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                  No nodes in this layer
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              nodes.map((node) => (
                <tr
                  key={node.id}
                  className="border-b border-gray-800 last:border-0 hover:bg-gray-900 transition-colors"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/nodes/${node.id}`}
                      className="text-blue-400 hover:text-blue-300"
                    >
                      {node.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{node.type}</td>
                  <td className="px-4 py-2.5 text-gray-300 font-mono text-xs">{node.version}</td>
                  <td className="px-4 py-2.5">
                    <LifecycleBadge status={node.lifecycleStatus} />
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {new Date(node.createdAt).toLocaleDateString()}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={() => setOffset(Math.max(0, offset - LIMIT))}
          disabled={offset === 0}
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          ← Prev
        </button>
        <span className="text-sm text-gray-500">
          {nodes.length > 0 ? `${offset + 1}–${offset + nodes.length}` : "0 results"}
        </span>
        <button
          onClick={() => setOffset(offset + LIMIT)}
          disabled={nodes.length < LIMIT}
          className="px-3 py-1.5 text-sm border border-gray-700 rounded text-gray-400 hover:text-gray-100 hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
