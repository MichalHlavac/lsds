// TraversalEngine — assembles a context package around a root node.
//
// References:
//   kap. 2.2  edge catalog + traversal weight
//   kap. 2.9  lifecycle states
//   kap. 2.10 traversal profiles
//   kap. 6.1  context package + token-aware truncation
//   kap. 8    persistence-agnostic engine + GraphRepository
//
// The framework owns the algorithm. Persistence (Postgres CTE, in-memory map,
// Neo4j adapter) implements GraphRepository — nothing in this file knows how
// the data is stored.

import type { LayerId } from "./layer/index.js";
import type { Lifecycle } from "./lifecycle.js";
import type { TknBase } from "./shared/base.js";
import type {
  RelationshipEdge,
  RelationshipType,
  TraversalWeight,
} from "./relationship/types.js";
import { getRelationshipDefinition } from "./relationship/registry.js";
import type { Severity, ViolationStatus, Violation } from "./guardrail/index.js";

export type TraversalProfile = "OPERATIONAL" | "ANALYTICAL" | "FULL";

// Read-side projection of a Violation as the GraphRepository delivers it for
// traversal/context assembly. The authoritative shape (Zod-validated,
// snake_case) lives in ./guardrail/violation; the `inherited` flag is set to
// true on propagated copies (kap. 2.5).
export type ViolationRecord = Violation & { inherited?: boolean };

export interface ProfileSpec {
  /** Edge weights visible under this profile. */
  edgeWeights: ReadonlyArray<TraversalWeight>;
  /** Lifecycle states visible under this profile. */
  lifecycles: ReadonlyArray<Lifecycle>;
  /** Include inherited (propagated) violations. */
  includeInheritedViolations: boolean;
  /** Include analytical buckets: decisions / requirements / debt / glossary. */
  includeAnalytical: boolean;
  /** Include archived/historical data alongside live nodes. */
  includeHistory: boolean;
}

export const PROFILE_SPEC: Record<TraversalProfile, ProfileSpec> = {
  OPERATIONAL: {
    edgeWeights: ["EAGER"],
    lifecycles: ["ACTIVE", "DEPRECATED"],
    includeInheritedViolations: false,
    includeAnalytical: false,
    includeHistory: false,
  },
  ANALYTICAL: {
    edgeWeights: ["EAGER", "LAZY"],
    lifecycles: ["ACTIVE", "DEPRECATED", "ARCHIVED"],
    includeInheritedViolations: false,
    includeAnalytical: true,
    includeHistory: false,
  },
  FULL: {
    edgeWeights: ["EAGER", "LAZY"],
    lifecycles: ["ACTIVE", "DEPRECATED", "ARCHIVED"],
    includeInheritedViolations: true,
    includeAnalytical: true,
    includeHistory: true,
  },
};

// Default depth limits per kap. 6.1.
export const DEFAULT_DEPTH = {
  upward: 3,
  downward: 2,
  lateral: 1,
} as const;

// Conservative default token budget. The caller normally overrides this with
// the actual model context window minus the prompt scaffolding overhead.
export const DEFAULT_TOKEN_BUDGET = 4000;

export interface NodeCard {
  id: string;
  type: string;
  layer: LayerId;
  name: string;
  lifecycle: Lifecycle;
  /** Hop distance from the root, sign indicates direction (+up / -down / 0 root or lateral). */
  distance: number;
  /** How this node was reached from the root. */
  via?: RelationshipType;
}

export interface ViolationSummary {
  id: string;
  ruleId: string;
  severity: Severity;
  status: ViolationStatus;
  message: string;
  inherited: boolean;
}

export interface TruncationReport {
  truncated: boolean;
  /** Count of nodes dropped from each bucket. */
  omitted: {
    upward: number;
    downward: number;
    lateral: number;
    decisions: number;
    requirements: number;
    debt: number;
    glossary: number;
  };
  /** Human-readable notes — must be surfaced to the LLM (kap. 6.1). */
  notes: string[];
}

export interface ContextPackage {
  profile: TraversalProfile;
  root: NodeCard;
  upward: NodeCard[];
  downward: NodeCard[];
  lateral: NodeCard[];
  decisions?: NodeCard[];
  requirements?: NodeCard[];
  debt?: NodeCard[];
  glossary?: NodeCard[];
  health: {
    violations: ViolationSummary[];
  };
  truncation: TruncationReport;
  estimatedTokens: number;
}

export interface TraversalOptions {
  profile?: TraversalProfile;
  maxDepth?: Partial<{ upward: number; downward: number; lateral: number }>;
  tokenBudget?: number;
}

export interface TraversalEngine {
  traverse(rootId: string, options?: TraversalOptions): Promise<ContextPackage>;
}

/**
 * Read-only repository over the knowledge graph. Concrete adapters live
 * outside the framework (Postgres CTE, Neo4j Cypher, in-memory test fixtures).
 *
 * All implementations MUST scope by tenant before this layer sees the data —
 * the engine is tenant-agnostic on purpose (kap. 8 + A6).
 */
export interface GraphRepository {
  getNode(id: string): Promise<TknBase | null>;
  getNodes(ids: ReadonlyArray<string>): Promise<TknBase[]>;
  /** Edges where node is `source`. */
  getOutgoingEdges(nodeId: string): Promise<RelationshipEdge[]>;
  /** Edges where node is `target`. */
  getIncomingEdges(nodeId: string): Promise<RelationshipEdge[]>;
  /** Violations for the supplied node ids. May include inherited ones. */
  getViolations(nodeIds: ReadonlyArray<string>): Promise<ViolationRecord[]>;
}

// --- Engine implementation -------------------------------------------------

type TraversalBucket = "upward" | "downward" | "lateral" | "cross-layer";

// Map the 19 RelationshipTypes onto the four traversal buckets the engine
// uses. Most types follow their `direction` field directly; `vertical` and
// `any` (kap. 2.2) are flattened into upward / cross-layer based on category
// (TRACEABILITY/MOTIVATION → upward; DECISION/VIOLATION → cross-layer).
function bucketForType(type: RelationshipType): TraversalBucket {
  const def = getRelationshipDefinition(type);
  switch (def.direction) {
    case "upward":
      return "upward";
    case "downward":
      return "downward";
    case "lateral":
      return "lateral";
    case "cross-layer":
      return "cross-layer";
    case "vertical":
      // Kap. 2.2 vertical edges (`traces-to`, `motivated-by`) point from
      // concrete toward abstract — same orientation as `upward` for traversal.
      return "upward";
    case "any":
      // Kap. 2.2 `decided-by` / `violates` are layer-agnostic and feed
      // analytical / health channels rather than the directional buckets.
      return "cross-layer";
  }
}

export class DefaultTraversalEngine implements TraversalEngine {
  constructor(private readonly repo: GraphRepository) {}

  async traverse(rootId: string, options: TraversalOptions = {}): Promise<ContextPackage> {
    const profile = options.profile ?? "OPERATIONAL";
    const spec = PROFILE_SPEC[profile];
    const depth = { ...DEFAULT_DEPTH, ...(options.maxDepth ?? {}) };
    const tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

    const root = await this.repo.getNode(rootId);
    if (!root) {
      throw new TraversalError(`Root node not found: ${rootId}`);
    }
    if (!spec.lifecycles.includes(root.lifecycle)) {
      throw new TraversalError(
        `Root node ${rootId} has lifecycle ${root.lifecycle} which is not visible under ${profile}`,
      );
    }

    const visited = new Set<string>([root.id]);
    const upward = await this.bfs(root, "upward", depth.upward, spec, visited);
    const downward = await this.bfs(root, "downward", depth.downward, spec, visited);
    const lateral = await this.bfs(root, "lateral", depth.lateral, spec, visited);

    let decisions: NodeCard[] | undefined;
    let requirements: NodeCard[] | undefined;
    let debt: NodeCard[] | undefined;
    let glossary: NodeCard[] | undefined;
    if (spec.includeAnalytical) {
      const analytical = await this.collectAnalytical(root, spec, visited);
      decisions = analytical.decisions;
      requirements = analytical.requirements;
      debt = analytical.debt;
      glossary = analytical.glossary;
    }

    const violations = await this.collectViolations(root, upward, downward, spec);

    const pkg: ContextPackage = {
      profile,
      root: cardForRoot(root),
      upward,
      downward,
      lateral,
      decisions,
      requirements,
      debt,
      glossary,
      health: { violations },
      truncation: emptyTruncation(),
      estimatedTokens: 0,
    };

    pkg.estimatedTokens = estimateTokens(pkg);
    truncateToBudget(pkg, tokenBudget);
    return pkg;
  }

  // BFS bucketed by direction. We follow:
  //   upward   = outgoing edges with bucket 'upward' + incoming edges with bucket 'downward'
  //   downward = outgoing edges with bucket 'downward' + incoming edges with bucket 'upward'
  //   lateral  = outgoing edges with bucket 'lateral'
  // Cross-layer edges (owned-by, decided-by, violates) never contribute to
  // these buckets — they feed analytical / health channels separately.
  private async bfs(
    root: TknBase,
    direction: "upward" | "downward" | "lateral",
    maxDepth: number,
    spec: ProfileSpec,
    visited: Set<string>,
  ): Promise<NodeCard[]> {
    if (maxDepth <= 0) return [];
    const out: NodeCard[] = [];
    const queue: Array<{ id: string; distance: number }> = [{ id: root.id, distance: 0 }];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current.distance >= maxDepth) continue;

      const [outgoing, incoming] = await Promise.all([
        this.repo.getOutgoingEdges(current.id),
        this.repo.getIncomingEdges(current.id),
      ]);

      const candidates: Array<{
        neighborId: string;
        via: RelationshipType;
        weight: TraversalWeight;
      }> = [];

      for (const e of outgoing) {
        const def = getRelationshipDefinition(e.type);
        if (matchesDirection(bucketForType(e.type), "outgoing", direction)) {
          candidates.push({
            neighborId: e.targetTknId,
            via: e.type,
            weight: def.traversalWeight,
          });
        }
      }
      for (const e of incoming) {
        const def = getRelationshipDefinition(e.type);
        if (matchesDirection(bucketForType(e.type), "incoming", direction)) {
          candidates.push({
            neighborId: e.sourceTknId,
            via: e.type,
            weight: def.traversalWeight,
          });
        }
      }

      const filtered = candidates.filter((c) => spec.edgeWeights.includes(c.weight));
      const newIds = filtered.map((c) => c.neighborId).filter((id) => !visited.has(id));
      if (newIds.length === 0) continue;

      const nodes = await this.repo.getNodes(newIds);
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      for (const c of filtered) {
        if (visited.has(c.neighborId)) continue;
        const n = nodeMap.get(c.neighborId);
        if (!n) continue;
        if (!spec.lifecycles.includes(n.lifecycle)) continue;
        visited.add(n.id);
        const distance =
          direction === "upward"
            ? current.distance + 1
            : direction === "downward"
              ? -(current.distance + 1)
              : 0;
        out.push({
          id: n.id,
          type: n.type,
          layer: n.layer,
          name: n.name,
          lifecycle: n.lifecycle,
          distance,
          via: c.via,
        });
        queue.push({ id: n.id, distance: Math.abs(distance) });
      }
    }

    // Order: nearest first, stable by name as tie-break.
    out.sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || a.name.localeCompare(b.name));
    return out;
  }

  private async collectAnalytical(
    root: TknBase,
    spec: ProfileSpec,
    visited: Set<string>,
  ): Promise<{
    decisions: NodeCard[];
    requirements: NodeCard[];
    debt: NodeCard[];
    glossary: NodeCard[];
  }> {
    // Decisions: outgoing decided-by edges from root → ADR
    const outgoing = await this.repo.getOutgoingEdges(root.id);
    const incoming = await this.repo.getIncomingEdges(root.id);

    const decisionIds = outgoing.filter((e) => e.type === "decided-by").map((e) => e.targetTknId);
    const requirementIds = outgoing
      .filter((e) => e.type === "motivated-by")
      .map((e) => e.targetTknId);
    // Technical debt usually points AT the affected module — debt nodes hold
    // a `traces-to` or `depends-on` edge against the source. Be liberal: pick
    // up any incoming edge whose source is of type TechnicalDebt.
    const allIncomingIds = incoming.map((e) => e.sourceTknId);
    const candidates = await this.repo.getNodes(allIncomingIds);
    const debtIds = candidates.filter((n) => n.type === "TechnicalDebt").map((n) => n.id);

    const [decisionNodes, requirementNodes, debtNodes] = await Promise.all([
      this.repo.getNodes(decisionIds),
      this.repo.getNodes(requirementIds),
      this.repo.getNodes(debtIds),
    ]);

    // Glossary: pick LanguageTerm nodes attached (via contains / part-of) to
    // any BoundedContext that we already know about (root or upward chain).
    // Glossary collection deferred — LanguageTerm registry not yet seeded
    // (LSDS-10 introduces LanguageTerm + BoundedContext; wire up after merge).
    const glossary: NodeCard[] = [];

    const filterVisible = (nodes: TknBase[], fallbackVia: RelationshipType): NodeCard[] =>
      nodes
        .filter((n) => spec.lifecycles.includes(n.lifecycle))
        .map((n) => {
          visited.add(n.id);
          return {
            id: n.id,
            type: n.type,
            layer: n.layer,
            name: n.name,
            lifecycle: n.lifecycle,
            distance: 0,
            via: fallbackVia,
          };
        });

    return {
      decisions: filterVisible(decisionNodes, "decided-by"),
      requirements: filterVisible(requirementNodes, "motivated-by"),
      debt: filterVisible(debtNodes, "traces-to"),
      glossary,
    };
  }

  private async collectViolations(
    root: TknBase,
    upward: NodeCard[],
    downward: NodeCard[],
    spec: ProfileSpec,
  ): Promise<ViolationSummary[]> {
    const ids: string[] = [root.id];
    if (spec.includeInheritedViolations) {
      ids.push(...upward.map((c) => c.id), ...downward.map((c) => c.id));
    }
    const raw = await this.repo.getViolations(ids);
    return raw
      .filter((v) => spec.includeInheritedViolations || !v.inherited)
      .map((v) => ({
        id: v.id,
        ruleId: v.rule_id,
        severity: v.severity,
        status: v.status,
        message: v.message,
        inherited: Boolean(v.inherited),
      }));
  }
}

// --- Helpers ---------------------------------------------------------------

export class TraversalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TraversalError";
  }
}

function cardForRoot(node: TknBase): NodeCard {
  return {
    id: node.id,
    type: node.type,
    layer: node.layer,
    name: node.name,
    lifecycle: node.lifecycle,
    distance: 0,
  };
}

function emptyTruncation(): TruncationReport {
  return {
    truncated: false,
    omitted: {
      upward: 0,
      downward: 0,
      lateral: 0,
      decisions: 0,
      requirements: 0,
      debt: 0,
      glossary: 0,
    },
    notes: [],
  };
}

// Outgoing edge of bucket 'upward'  → neighbor is above me.
// Incoming edge of bucket 'downward' → neighbor is above me.
// And so on for the other directions.
function matchesDirection(
  bucket: TraversalBucket,
  edgeDirection: "outgoing" | "incoming",
  target: "upward" | "downward" | "lateral",
): boolean {
  if (bucket === "cross-layer") return false;
  if (bucket === "lateral") {
    // Lateral edges contribute only to the lateral bucket and only as
    // outgoing — incoming peer edges would otherwise double-count.
    return target === "lateral" && edgeDirection === "outgoing";
  }
  if (target === "lateral") return false;
  if (target === "upward") {
    return (
      (edgeDirection === "outgoing" && bucket === "upward") ||
      (edgeDirection === "incoming" && bucket === "downward")
    );
  }
  // target === "downward"
  return (
    (edgeDirection === "outgoing" && bucket === "downward") ||
    (edgeDirection === "incoming" && bucket === "upward")
  );
}

// Conservative token estimator: ~4 characters per token (OpenAI/Anthropic
// rule of thumb for English text). Adapters MAY swap in a real tokenizer if
// they care to — kap. 6.1 specifies budget enforcement, not the counter.
export function estimateTokens(
  pkg: Pick<
    ContextPackage,
    | "root"
    | "upward"
    | "downward"
    | "lateral"
    | "decisions"
    | "requirements"
    | "debt"
    | "glossary"
    | "health"
    | "truncation"
    | "profile"
  >,
): number {
  const serialised = JSON.stringify(pkg);
  return Math.ceil(serialised.length / 4);
}

// Truncate the package in place to fit within `budget` tokens. Drop priority,
// from least-important to most-important (kap. 6.1):
//   1. downward farthest first
//   2. lateral
//   3. analytical buckets (debt → glossary → requirements → decisions)
//   4. upward farthest first  (only as a last resort — upward context is
//      the most valuable for an LLM trying to reason about *why*)
export function truncateToBudget(pkg: ContextPackage, budget: number): void {
  if (budget <= 0) return;
  if (pkg.estimatedTokens <= budget) return;

  const dropOne = (bucket: keyof TruncationReport["omitted"]): boolean => {
    let arr: NodeCard[] | undefined;
    switch (bucket) {
      case "upward":
        arr = pkg.upward;
        break;
      case "downward":
        arr = pkg.downward;
        break;
      case "lateral":
        arr = pkg.lateral;
        break;
      case "decisions":
        arr = pkg.decisions;
        break;
      case "requirements":
        arr = pkg.requirements;
        break;
      case "debt":
        arr = pkg.debt;
        break;
      case "glossary":
        arr = pkg.glossary;
        break;
    }
    if (!arr || arr.length === 0) return false;
    // Drop the farthest card. For analytical buckets distance is 0 so we
    // just drop the last entry.
    let idx = arr.length - 1;
    let maxDist = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const d = Math.abs(arr[i]!.distance);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    arr.splice(idx, 1);
    pkg.truncation.omitted[bucket] += 1;
    pkg.truncation.truncated = true;
    return true;
  };

  // Reverse priority order — what we drop FIRST is what we value LEAST.
  const order: Array<keyof TruncationReport["omitted"]> = [
    "downward",
    "lateral",
    "debt",
    "glossary",
    "requirements",
    "decisions",
    "upward",
  ];

  for (const bucket of order) {
    while (pkg.estimatedTokens > budget && dropOne(bucket)) {
      pkg.estimatedTokens = estimateTokens(pkg);
    }
    if (pkg.estimatedTokens <= budget) break;
  }

  if (pkg.truncation.truncated) {
    const o = pkg.truncation.omitted;
    const parts: string[] = [];
    if (o.upward) parts.push(`${o.upward} upward`);
    if (o.lateral) parts.push(`${o.lateral} lateral`);
    if (o.downward) parts.push(`${o.downward} downward`);
    if (o.decisions) parts.push(`${o.decisions} decisions`);
    if (o.requirements) parts.push(`${o.requirements} requirements`);
    if (o.debt) parts.push(`${o.debt} debt`);
    if (o.glossary) parts.push(`${o.glossary} glossary`);
    pkg.truncation.notes.push(`Context truncated: ${parts.join(", ")} omitted to fit token budget.`);
  }
}
