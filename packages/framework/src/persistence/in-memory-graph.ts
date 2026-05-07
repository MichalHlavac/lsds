// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// In-memory GraphRepository — process-lifetime adapter that satisfies the
// persistence boundary the framework defines in ./traversal.ts. Intended for
// framework-level tests, downstream consumer tests (apps/api), and the future
// Neo4j spike (G7 R&D). Not a durable store; not multi-tenant aware (kap. 8 +
// A6: scoping happens above the framework).
//
// Behavioral parity with the Postgres adapter:
//   - getOutgoingEdges / getIncomingEdges return defensive copies in stable
//     order (target_tkn_id, type) / (source_tkn_id, type) so that BFS ordering
//     across adapters is identical.
//   - getNodes preserves the caller's id ordering and silently drops missing
//     ids (matches a left-anti join, not an error).
//   - getViolations returns [] for empty input rather than throwing.
//
// References:
//   kap. 8        persistence-agnostic engine + GraphRepository contract
//   ADR A1        in-memory map / Postgres CTE / Neo4j adapters interchangeable
//   LSDS-546      ratification: GraphRepository is the swap point, not Engine

import type { RelationshipEdge } from "../relationship/types.js";
import type { TknBase } from "../shared/base.js";
import type { GraphRepository, ViolationRecord } from "../traversal.js";

export class InMemoryGraphRepository implements GraphRepository {
  readonly #nodes = new Map<string, TknBase>();
  readonly #outgoing = new Map<string, RelationshipEdge[]>();
  readonly #incoming = new Map<string, RelationshipEdge[]>();
  readonly #violations: ViolationRecord[] = [];

  /**
   * Insert or replace a node by id. Replacing reuses the supplied reference;
   * the engine reads node fields fresh per call so a stale reference cannot
   * leak across reads.
   */
  addNode(node: TknBase): this {
    this.#nodes.set(node.id, node);
    return this;
  }

  /**
   * Append an edge. Indexed by source and target id for O(1) adjacency
   * lookup. The adapter does not enforce node existence at write time
   * (parity with a Postgres install that has no FK constraint declared);
   * dangling references are skipped on read.
   */
  addEdge(edge: RelationshipEdge): this {
    pushIndexed(this.#outgoing, edge.sourceTknId, edge);
    pushIndexed(this.#incoming, edge.targetTknId, edge);
    return this;
  }

  addViolation(v: ViolationRecord): this {
    this.#violations.push(v);
    return this;
  }

  /** Empty all storage. */
  clear(): this {
    this.#nodes.clear();
    this.#outgoing.clear();
    this.#incoming.clear();
    this.#violations.length = 0;
    return this;
  }

  /**
   * Fresh repository populated with structural copies of the current state.
   * Property tests use this to mutate a baseline graph without disturbing
   * the source of truth.
   */
  snapshot(): InMemoryGraphRepository {
    const copy = new InMemoryGraphRepository();
    for (const node of this.#nodes.values()) {
      copy.addNode({ ...node });
    }
    // Iterate via the outgoing index — every edge is registered there exactly
    // once, so we avoid the double-count of going through both indexes.
    for (const edges of this.#outgoing.values()) {
      for (const e of edges) copy.addEdge({ ...e });
    }
    for (const v of this.#violations) {
      copy.addViolation(cloneViolation(v));
    }
    return copy;
  }

  get nodeCount(): number {
    return this.#nodes.size;
  }

  get edgeCount(): number {
    let n = 0;
    for (const arr of this.#outgoing.values()) n += arr.length;
    return n;
  }

  get violationCount(): number {
    return this.#violations.length;
  }

  // ── GraphRepository contract ──────────────────────────────────────────────

  async getNode(id: string): Promise<TknBase | null> {
    return this.#nodes.get(id) ?? null;
  }

  async getNodes(ids: ReadonlyArray<string>): Promise<TknBase[]> {
    if (ids.length === 0) return [];
    const out: TknBase[] = [];
    for (const id of ids) {
      const n = this.#nodes.get(id);
      if (n !== undefined) out.push(n);
    }
    return out;
  }

  async getOutgoingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    const edges = this.#outgoing.get(nodeId);
    if (!edges || edges.length === 0) return [];
    return [...edges].sort(compareOutgoing);
  }

  async getIncomingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    const edges = this.#incoming.get(nodeId);
    if (!edges || edges.length === 0) return [];
    return [...edges].sort(compareIncoming);
  }

  async getViolations(nodeIds: ReadonlyArray<string>): Promise<ViolationRecord[]> {
    if (nodeIds.length === 0) return [];
    const set = new Set(nodeIds);
    return this.#violations.filter((v) => set.has(v.object_id));
  }
}

function pushIndexed(
  map: Map<string, RelationshipEdge[]>,
  key: string,
  edge: RelationshipEdge,
): void {
  const existing = map.get(key);
  if (existing) existing.push(edge);
  else map.set(key, [edge]);
}

function compareOutgoing(a: RelationshipEdge, b: RelationshipEdge): number {
  return a.targetTknId.localeCompare(b.targetTknId) || a.type.localeCompare(b.type);
}

function compareIncoming(a: RelationshipEdge, b: RelationshipEdge): number {
  return a.sourceTknId.localeCompare(b.sourceTknId) || a.type.localeCompare(b.type);
}

function cloneViolation(v: ViolationRecord): ViolationRecord {
  return {
    ...v,
    suppression: v.suppression ? { ...v.suppression } : undefined,
  };
}
