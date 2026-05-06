// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// In-memory GraphRepository — first-class persistence adapter for tests, CLI
// dry-runs, and bootstrap scenarios where a real datastore isn't appropriate.
//
// Contract — kap. 8 + A6:
//   - Tenant-agnostic: callers MUST pre-scope nodes/edges/violations to a
//     single tenant before constructing or seeding the adapter. The repo does
//     not filter by tenant.
//   - Idempotent reads: getNode / getNodes / getOutgoingEdges /
//     getIncomingEdges / getViolations never mutate state. Repeated calls with
//     the same arguments return logically equivalent results.
//   - No implicit defaults beyond GraphRepository: missing nodes resolve to
//     null (single) or are filtered out (batch); empty edge/violation lists
//     are valid.
//
// The adapter is purposefully simple — it is not optimized for large graphs.
// Production deployments should swap in the Postgres CTE or Neo4j adapter via
// the same `GraphRepository` interface; `DefaultTraversalEngine` does not
// change.

import type { TknBase } from "../shared/base.js";
import type { RelationshipEdge } from "../relationship/types.js";
import type { GraphRepository, ViolationRecord } from "../traversal.js";

export interface InMemoryGraphSeed {
  readonly nodes?: ReadonlyArray<TknBase>;
  readonly edges?: ReadonlyArray<RelationshipEdge>;
  readonly violations?: ReadonlyArray<ViolationRecord>;
}

/**
 * In-memory implementation of {@link GraphRepository}.
 *
 * Construction:
 * - `new InMemoryGraphRepository()` — empty graph, mutate via add* methods.
 * - `new InMemoryGraphRepository({ nodes, edges, violations })` — seeded from
 *   a snapshot. The seed arrays are copied; subsequent mutation of the source
 *   arrays does not affect this repository, and add* on this repository does
 *   not affect the seed.
 *
 * Mutation is exposed only via {@link addNode} / {@link addEdge} /
 * {@link addViolation} so callers cannot bypass the (currently trivial)
 * indexing invariants by writing to internal collections directly.
 */
export class InMemoryGraphRepository implements GraphRepository {
  readonly #nodes = new Map<string, TknBase>();
  readonly #edges: RelationshipEdge[] = [];
  readonly #violations: ViolationRecord[] = [];

  constructor(seed?: InMemoryGraphSeed) {
    if (seed?.nodes) {
      for (const n of seed.nodes) {
        this.#nodes.set(n.id, n);
      }
    }
    if (seed?.edges) {
      this.#edges.push(...seed.edges);
    }
    if (seed?.violations) {
      this.#violations.push(...seed.violations);
    }
  }

  /** Insert or replace a node by id. Returns `this` for chaining. */
  addNode(node: TknBase): this {
    this.#nodes.set(node.id, node);
    return this;
  }

  /** Append an edge. Duplicates are not deduplicated (mirrors a row-store). */
  addEdge(edge: RelationshipEdge): this {
    this.#edges.push(edge);
    return this;
  }

  /** Append a violation record. Suppression/lifecycle is the caller's concern. */
  addViolation(v: ViolationRecord): this {
    this.#violations.push(v);
    return this;
  }

  async getNode(id: string): Promise<TknBase | null> {
    return this.#nodes.get(id) ?? null;
  }

  async getNodes(ids: ReadonlyArray<string>): Promise<TknBase[]> {
    return ids
      .map((id) => this.#nodes.get(id))
      .filter((n): n is TknBase => n !== undefined);
  }

  async getOutgoingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    return this.#edges.filter((e) => e.sourceTknId === nodeId);
  }

  async getIncomingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    return this.#edges.filter((e) => e.targetTknId === nodeId);
  }

  async getViolations(nodeIds: ReadonlyArray<string>): Promise<ViolationRecord[]> {
    const set = new Set(nodeIds);
    return this.#violations.filter((v) => set.has(v.object_id));
  }
}
