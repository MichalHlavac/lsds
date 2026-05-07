# @lsds/framework

The LSDS Framework — tenant-agnostic, persistence-agnostic core. Type registry (L1–L6), layer model, relationship rules, structural guardrails, traversal algebra, change propagation. Pure TypeScript, no runtime dependencies on any database.

## In-memory graph adapter

`InMemoryGraphRepository` is the framework's reference implementation of the `GraphRepository` boundary. It satisfies the same contract as the Postgres CTE adapter and is intended for:

- Framework-level tests (no Postgres required).
- Downstream consumer tests (`apps/api`, future SDK consumers).
- Spikes against alternative graph backends.

It is **not** a durable store and is **not** multi-tenant aware. Tenant scoping happens above the framework.

```ts
import {
  DefaultTraversalEngine,
  InMemoryGraphRepository,
} from "@lsds/framework";

const graph = new InMemoryGraphRepository();

graph
  .addNode({
    id: "svc-1",
    type: "Service",
    layer: "L4",
    name: "OrderService",
    version: "1.0.0",
    lifecycle: "ACTIVE",
    createdAt: "2026-04-28T12:00:00.000Z",
    updatedAt: "2026-04-28T12:00:00.000Z",
  })
  .addNode({
    id: "ep-1",
    type: "APIEndpoint",
    layer: "L4",
    name: "POST /orders",
    version: "1.0.0",
    lifecycle: "ACTIVE",
    createdAt: "2026-04-28T12:00:00.000Z",
    updatedAt: "2026-04-28T12:00:00.000Z",
  })
  .addEdge({
    type: "contains",
    sourceLayer: "L4",
    targetLayer: "L4",
    sourceTknId: "svc-1",
    targetTknId: "ep-1",
  });

const engine = new DefaultTraversalEngine(graph);
const pkg = await engine.traverse("ep-1", { profile: "OPERATIONAL" });
```

### Snapshot semantics

`snapshot()` returns a structurally independent copy. Mutations to either side do not affect the other — useful for property tests that mutate baseline graphs.

```ts
const baseline = buildBaseline();
const scenario = baseline.snapshot();
scenario.addEdge({ /* ... */ });   // baseline unchanged
```

### Read-side guarantees

| Method | Guarantee |
|---|---|
| `getNode(id)` | Returns the stored node or `null`; never throws on missing. |
| `getNodes(ids)` | Preserves caller order; silently drops missing ids; returns `[]` for empty input. |
| `getOutgoingEdges(id)` | Defensive copy, sorted by `(targetTknId, type)` for deterministic BFS across adapters. |
| `getIncomingEdges(id)` | Defensive copy, sorted by `(sourceTknId, type)`. |
| `getViolations(ids)` | `[]` for empty input; filtered by `object_id`. |

The contract is pinned by property tests in `tests/persistence/in-memory-graph.test.ts`. Any future adapter (Postgres, Neo4j) MUST satisfy the same invariants.
