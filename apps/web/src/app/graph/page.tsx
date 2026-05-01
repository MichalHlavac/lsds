// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import type {
  Edge,
  EdgeMouseHandler,
  Node,
  NodeMouseHandler,
  NodeProps,
} from "@xyflow/react";
import { api } from "../../lib/api";
import type { EdgeRow, NodeRow } from "../../lib/api";

const NODE_BATCH = 100;
const EDGE_BATCH = 200;
const COLS = 6;
const H_GAP = 230;
const V_GAP = 90;

const LAYER_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  L1: { border: "#3b82f6", bg: "#1e3a5f", text: "#93c5fd" },
  L2: { border: "#22c55e", bg: "#14532d", text: "#86efac" },
  L3: { border: "#f59e0b", bg: "#451a03", text: "#fcd34d" },
  L4: { border: "#a855f7", bg: "#3b0764", text: "#d8b4fe" },
  L5: { border: "#f97316", bg: "#431407", text: "#fdba74" },
  L6: { border: "#ef4444", bg: "#450a0a", text: "#fca5a5" },
};

function nodeToFlow(n: NodeRow, idx: number): Node {
  return {
    id: n.id,
    position: { x: (idx % COLS) * H_GAP, y: Math.floor(idx / COLS) * V_GAP },
    data: { name: n.name, layer: n.layer },
    type: "lsdsNode",
  };
}

function edgeToFlow(e: EdgeRow): Edge {
  return { id: e.id, source: e.sourceId, target: e.targetId };
}

function LsdsNode({ data }: NodeProps) {
  const layer = String(data.layer);
  const colors = LAYER_COLORS[layer] ?? { border: "#4b5563", bg: "#1f2937", text: "#9ca3af" };
  return (
    <>
      <Handle type="target" position={Position.Top} />
      <div
        className="rounded px-3 py-2 text-left min-w-[140px] max-w-[200px] cursor-pointer transition-all"
        style={{
          background: colors.bg,
          border: `1px solid ${colors.border}`,
        }}
      >
        <p className="text-white text-sm font-medium truncate">{String(data.name)}</p>
        <p className="text-xs font-mono" style={{ color: colors.text }}>{layer}</p>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </>
  );
}

const nodeTypes = { lsdsNode: LsdsNode };

export default function GraphPage() {
  const router = useRouter();
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<Node>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [nodeOffset, setNodeOffset] = useState(0);
  const [edgeOffset, setEdgeOffset] = useState(0);
  const [hasMoreNodes, setHasMoreNodes] = useState(true);
  const [hasMoreEdges, setHasMoreEdges] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialLoad, setInitialLoad] = useState(true);

  const loadedNodeIds = useMemo(() => new Set(rfNodes.map((n) => n.id)), [rfNodes]);

  const loadBatch = useCallback(
    async (nOffset: number, eOffset: number) => {
      setLoading(true);
      setError(null);
      try {
        const [nodesRes, edgesRes] = await Promise.all([
          hasMoreNodes
            ? api.nodes.list({ limit: NODE_BATCH, offset: nOffset })
            : Promise.resolve(null),
          hasMoreEdges
            ? api.edges.list({ limit: EDGE_BATCH, offset: eOffset })
            : Promise.resolve(null),
        ]);

        if (nodesRes) {
          const batch: NodeRow[] = nodesRes.data;
          setRfNodes((prev) => [
            ...prev,
            ...batch.map((n, i) => nodeToFlow(n, nOffset + i)),
          ]);
          if (batch.length < NODE_BATCH) setHasMoreNodes(false);
          setNodeOffset(nOffset + batch.length);
        }

        if (edgesRes) {
          const batch: EdgeRow[] = edgesRes.data;
          setRfEdges((prev) => {
            const existingIds = new Set(prev.map((e) => e.id));
            return [
              ...prev,
              ...batch.map(edgeToFlow).filter((e) => !existingIds.has(e.id)),
            ];
          });
          if (batch.length < EDGE_BATCH) setHasMoreEdges(false);
          setEdgeOffset(eOffset + batch.length);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load graph data");
      } finally {
        setLoading(false);
        setInitialLoad(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasMoreNodes, hasMoreEdges],
  );

  useEffect(() => {
    loadBatch(0, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_, node) => router.push(`/nodes/${node.id}`),
    [router],
  );

  const onEdgeClick: EdgeMouseHandler = useCallback(
    (_, edge) => router.push(`/edges/${edge.id}`),
    [router],
  );

  const visibleEdges = useMemo(
    () => rfEdges.filter((e) => loadedNodeIds.has(e.source) && loadedNodeIds.has(e.target)),
    [rfEdges, loadedNodeIds],
  );

  const hasMore = hasMoreNodes || hasMoreEdges;

  if (error && initialLoad) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="-m-8 flex flex-col" style={{ height: "100vh" }}>
      <div className="flex items-center justify-between px-6 py-3 border-b border-gray-800 shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-semibold text-white">Graph Canvas</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {Object.entries(LAYER_COLORS).map(([layer, c]) => (
              <span
                key={layer}
                className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded"
                style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
              >
                {layer}
              </span>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          {initialLoad ? (
            <span className="text-gray-400 text-sm">Loading…</span>
          ) : (
            <span className="text-gray-400 text-sm">
              {rfNodes.length} nodes · {visibleEdges.length} edges
            </span>
          )}
          {hasMore && !initialLoad && (
            <button
              onClick={() => loadBatch(nodeOffset, edgeOffset)}
              disabled={loading}
              className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white text-sm rounded transition-colors"
            >
              {loading ? "Loading…" : "Load more"}
            </button>
          )}
          {error && !initialLoad && (
            <span className="text-red-400 text-sm">{error}</span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ReactFlow
          nodes={rfNodes}
          edges={visibleEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          fitView
          nodesConnectable={false}
          nodesDraggable={false}
          colorMode="dark"
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  );
}
