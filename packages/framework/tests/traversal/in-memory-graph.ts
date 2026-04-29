// In-memory GraphRepository fixture for framework tests.
// Lives next to the tests so it never leaks into production builds.

import type { LayerId } from "../../src/layer/index.js";
import type { Lifecycle } from "../../src/lifecycle.js";
import type { TknBase } from "../../src/shared/base.js";
import type {
  RelationshipEdge,
  RelationshipType,
} from "../../src/relationship/types.js";
import type { GraphRepository, ViolationRecord } from "../../src/traversal.js";

export class InMemoryGraph implements GraphRepository {
  readonly nodes = new Map<string, TknBase>();
  readonly edges: RelationshipEdge[] = [];
  readonly violations: ViolationRecord[] = [];

  addNode(node: TknBase): this {
    this.nodes.set(node.id, node);
    return this;
  }

  addEdge(edge: RelationshipEdge): this {
    this.edges.push(edge);
    return this;
  }

  addViolation(v: ViolationRecord): this {
    this.violations.push(v);
    return this;
  }

  async getNode(id: string): Promise<TknBase | null> {
    return this.nodes.get(id) ?? null;
  }

  async getNodes(ids: ReadonlyArray<string>): Promise<TknBase[]> {
    return ids.map((id) => this.nodes.get(id)).filter((n): n is TknBase => n !== undefined);
  }

  async getOutgoingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    return this.edges.filter((e) => e.sourceTknId === nodeId);
  }

  async getIncomingEdges(nodeId: string): Promise<RelationshipEdge[]> {
    return this.edges.filter((e) => e.targetTknId === nodeId);
  }

  async getViolations(nodeIds: ReadonlyArray<string>): Promise<ViolationRecord[]> {
    const set = new Set(nodeIds);
    return this.violations.filter((v) => set.has(v.object_id));
  }
}

let counter = 0;
const id = (prefix: string) => `${prefix}-${++counter}`;

const FIXED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

export interface NodeOpts {
  id?: string;
  type: string;
  layer: LayerId;
  name: string;
  lifecycle?: Lifecycle;
}

export function makeNode(opts: NodeOpts): TknBase {
  return {
    id: opts.id ?? id("n"),
    type: opts.type,
    layer: opts.layer,
    name: opts.name,
    version: "1.0.0",
    lifecycle: opts.lifecycle ?? "ACTIVE",
    createdAt: FIXED_TIMESTAMP,
    updatedAt: FIXED_TIMESTAMP,
  };
}

export function makeEdge(
  source: TknBase,
  target: TknBase,
  type: RelationshipType,
): RelationshipEdge {
  return {
    type,
    sourceLayer: source.layer,
    targetLayer: target.layer,
    sourceTknId: source.id,
    targetTknId: target.id,
  };
}

export function resetCounter(): void {
  counter = 0;
}
