# LSDS REST API Reference

All requests require the `x-tenant-id` header (your tenant UUID). All bodies and responses are JSON.

Base URL: `http://<host>:3001`

---

## Conventions

### Enum values

All enum fields use **SCREAMING_SNAKE_CASE**. The API accepts both uppercase and mixed-case input — values are normalised to uppercase internally. Canonical values are listed for each field.

| Field | Valid values |
|-------|-------------|
| `layer` | `L1` `L2` `L3` `L4` `L5` `L6` |
| `lifecycleStatus` | `ACTIVE` `DEPRECATED` `ARCHIVED` `PURGE` |
| `severity` | `ERROR` `WARN` `INFO` |

> **Note on `severity`:** The API accepts lowercase input (`"error"`, `"warn"`, `"info"`) and normalises it to uppercase. Storing and querying always returns the uppercase canonical form.

### Common headers

| Header | Required | Description |
|--------|----------|-------------|
| `Content-Type` | POST/PATCH | `application/json` |
| `x-tenant-id` | All | Tenant UUID for data isolation |
| `Authorization` | When OIDC enabled | `Bearer <JWT>` |

### Error responses

```json
{ "error": "validation error", "issues": [...] }
```

---

## Nodes

### `GET /v1/nodes`

List nodes. Optional query params: `layer`, `type`, `lifecycleStatus`, `text` (full-text), `limit` (default 50, max 500), `offset`.

### `POST /v1/nodes`

Create a node.

```json
{
  "type": "BusinessCapability",
  "layer": "L1",
  "name": "Customer Onboarding",
  "version": "1.0.0",
  "lifecycleStatus": "ACTIVE",
  "attributes": {}
}
```

Required: `type`, `layer`, `name`.

### `GET /v1/nodes/:id`

Get a node by UUID.

### `PATCH /v1/nodes/:id`

Update a node. All fields optional.

### `DELETE /v1/nodes/:id`

Delete a node and its edges.

### `POST /v1/nodes/:id/traverse`

Traverse the graph from a node.

```json
{ "depth": 3, "direction": "both", "edgeTypes": ["depends-on"] }
```

---

## Edges

### `GET /v1/edges`

List edges. Optional query params: `layer`, `type`, `sourceId`, `targetId`, `limit`, `offset`.

### `POST /v1/edges`

Create an edge.

```json
{
  "sourceId": "<uuid>",
  "targetId": "<uuid>",
  "type": "depends-on",
  "layer": "L4",
  "traversalWeight": 1.0,
  "attributes": {}
}
```

Required: `sourceId`, `targetId`, `type`, `layer`.

### `GET /v1/edges/:id`

Get an edge by UUID.

### `PATCH /v1/edges/:id`

Update an edge. All fields optional.

### `DELETE /v1/edges/:id`

Delete an edge.

---

## Guardrails

Guardrails are tenant-scoped rules that evaluate the knowledge graph and produce violations. Structural guardrails are built into the framework (immutable); semantic guardrails are configurable per tenant via this API.

### `GET /v1/guardrails`

List all guardrails for the tenant. Optional query param: `enabled` (`true` / `false`).

**Response:**
```json
{
  "data": [
    {
      "id": "<uuid>",
      "tenantId": "<uuid>",
      "ruleKey": "naming.node.min_length",
      "description": "Node names must be at least 5 characters",
      "severity": "WARN",
      "enabled": true,
      "config": { "minLength": 5 },
      "createdAt": "2026-05-01T00:00:00.000Z",
      "updatedAt": "2026-05-01T00:00:00.000Z"
    }
  ]
}
```

### `POST /v1/guardrails`

Create or upsert a guardrail (upsert on `ruleKey`).

```json
{
  "ruleKey": "naming.node.min_length",
  "description": "Node names must be at least 5 characters",
  "severity": "WARN",
  "enabled": true,
  "config": { "minLength": 5 }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `ruleKey` | string | Yes | Unique rule identifier for this tenant |
| `severity` | enum | Yes | `ERROR`, `WARN`, or `INFO` (case-insensitive) |
| `description` | string | No | Default: `""` |
| `enabled` | boolean | No | Default: `true` |
| `config` | object | No | Rule-specific parameters. Default: `{}` |

> **`severity` is case-insensitive.** The API accepts `"error"`, `"Error"`, or `"ERROR"` — all are stored as `"ERROR"`. Only `ERROR`, `WARN`, and `INFO` are valid values; anything else returns 400.

**Response:** `201 Created`
```json
{ "data": { "id": "<uuid>", "ruleKey": "naming.node.min_length", "severity": "WARN", ... } }
```

### `GET /v1/guardrails/:id`

Get a guardrail by UUID.

### `PATCH /v1/guardrails/:id`

Update a guardrail. All fields optional.

```json
{
  "severity": "ERROR",
  "enabled": false,
  "config": { "minLength": 3 }
}
```

### `DELETE /v1/guardrails/:id`

Delete a guardrail.

---

## Violations

Violations are guardrail findings recorded against nodes or edges.

### `GET /v1/violations`

List violations. Optional query params: `nodeId`, `ruleKey`, `severity`, `limit`, `offset`.

### `POST /v1/violations`

Record a violation manually (guardrail evaluation also writes violations automatically).

```json
{
  "ruleKey": "naming.node.min_length",
  "severity": "WARN",
  "message": "Node name 'API' is too short (min 5 chars)",
  "nodeId": "<uuid>",
  "attributes": {}
}
```

`severity` follows the same case-insensitive behaviour as guardrails.

---

## Lifecycle

Nodes and edges follow the lifecycle: `ACTIVE → DEPRECATED → ARCHIVED → PURGE`.

### `POST /v1/nodes/:id/lifecycle`

Transition a node's lifecycle status.

```json
{ "transition": "deprecate" }
```

Valid transitions: `deprecate`, `archive`, `purge`.

---

## Snapshots

### `GET /v1/snapshots`

List all snapshots.

### `POST /v1/snapshots`

Create a point-in-time snapshot of the graph.

```json
{ "label": "pre-migration-2026-05-01" }
```

---

## Users & Teams

### `POST /v1/users`

Create a user.

```json
{
  "externalId": "alice@corp.com",
  "displayName": "Alice",
  "email": "alice@corp.com",
  "role": "editor"
}
```

Roles: `admin`, `editor`, `viewer`.

### `GET /v1/users`, `GET /v1/users/:id`, `DELETE /v1/users/:id`

List, get, or delete users.

### `POST /v1/teams`, `GET /v1/teams`, `GET /v1/teams/:id`

Manage teams.

---

## Import / Export

### `POST /v1/import/bulk`

Bulk-import nodes and edges in a single atomic transaction. If any item fails (duplicate key, missing source node, guardrail violation) the entire batch is rolled back — no partial writes.

**Request body:**

```json
{
  "nodes": [
    {
      "type": "Service",
      "layer": "L4",
      "name": "payments-api",
      "version": "1.0.0",
      "lifecycleStatus": "ACTIVE",
      "attributes": {}
    }
  ],
  "edges": [
    {
      "sourceId": "<node-uuid>",
      "targetId": "<node-uuid>",
      "type": "depends-on",
      "layer": "L4",
      "traversalWeight": 1.0,
      "attributes": {}
    }
  ]
}
```

Required per node: `type`, `layer`, `name`. Required per edge: `sourceId`, `targetId`, `type`, `layer`.

**Row cap: 50,000 nodes + edges combined.** Requests exceeding this limit are rejected with `422` before any DB writes occur. To import larger datasets, split into batches of ≤ 50,000 rows and send them sequentially.

**Responses:**

| Status | Meaning |
|--------|---------|
| `201 Created` | All items created. Body: `{ "data": { "created": { "nodes": ["<uuid>", ...], "edges": ["<uuid>", ...] }, "errors": [] } }` |
| `400 Bad Request` | Schema validation error (malformed JSON, invalid enum values). |
| `409 Conflict` | Duplicate key within the batch or against existing data. The `(type, layer, name)` tuple must be unique per tenant for nodes; `(sourceId, targetId, type)` must be unique for edges. The `detail` field in the response body identifies the conflicting key. |
| `422 Unprocessable Entity` | Row cap exceeded, missing source/target node, or cross-layer guardrail violation. |

**Handling 409 — retry recipe:**

1. Parse the `detail` field of the 409 response to identify the conflicting key (e.g., `Key (tenant_id, type, layer, name)=(...) already exists`).
2. Remove the conflicting items from your batch (they already exist in the graph).
3. Re-send the deduplicated remainder. Repeat until the full dataset is imported.

**Webhook:** A single `import.completed` event is emitted per successful import (not per row). Subscribe via the admin webhook endpoint with `event_types: ["import.completed"]`.

```json
{
  "event": "import.completed",
  "importId": "<server-generated-uuid>",
  "tenantId": "<uuid>",
  "nodeCount": 42,
  "edgeCount": 17,
  "createdAt": "2026-05-09T12:00:00.000Z"
}
```

**Audit trail:** Each inserted node generates a `node.create` audit log entry; each inserted edge generates an `edge.create` entry. On rollback, no audit entries are written.

---

### `GET /v1/export`

Stream the entire tenant graph as [Newline-Delimited JSON (NDJSON)](https://github.com/ndjson/ndjson-spec). Nodes are emitted first, then edges — this guarantees that every edge's `sourceId` and `targetId` reference a node that has already appeared in the stream. Use this endpoint for data portability, backup, or migrating a graph to another tenant.

**Response:** `200 OK` with `Content-Type: application/x-ndjson`. Each line is a self-contained JSON object.

**Node line shape:**

```json
{"type":"node","id":"<uuid>","layer":"L4","nodeType":"Service","name":"payments-api","version":"1.0.0","lifecycleStatus":"ACTIVE","attributes":{},"createdAt":"2026-05-09T12:00:00.000Z"}
```

**Edge line shape:**

```json
{"type":"edge","id":"<uuid>","sourceId":"<uuid>","targetId":"<uuid>","edgeType":"depends-on","layer":"L4","traversalWeight":1.0,"lifecycleStatus":"ACTIVE","attributes":{},"createdAt":"2026-05-09T12:00:00.000Z"}
```

Note: the edge's relationship type is under the key `edgeType` (not `type`, which identifies the line kind).

**Optional query parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `lifecycleStatus` | enum | Filter to `ACTIVE`, `DEPRECATED`, `ARCHIVED`, or `PURGE`. Applies to both nodes and edges independently. |
| `layer` | enum | Filter to a specific layer (`L1`–`L6`). Applies to both nodes and edges. |

**Ordering invariant:** All node lines appear before any edge lines. This means you can read the stream sequentially and build a complete node index before processing edges — the export is safe to pipe directly into an importer that resolves edge endpoints by ID.

**Round-trip import:** To re-import an NDJSON export into a fresh tenant:

1. Parse all node lines. For each, call `POST /v1/nodes` (or collect into a `POST /v1/import/bulk` payload) using `nodeType` → `type`, preserving `layer`, `name`, `version`, `lifecycleStatus`, and `attributes`.
2. Build a mapping from exported node `id` to the newly assigned `id` in the target tenant.
3. Parse all edge lines. For each, remap `sourceId` and `targetId` using the mapping, then create the edge.

**No webhook** is emitted for export operations.

**Streaming:** The response is streamed via a server-side PostgreSQL cursor. Memory usage on the server is bounded regardless of graph size.

---

## Health

### `GET /health`

Returns API status. No `x-tenant-id` required.

```json
{ "status": "ok", "ts": "2026-05-01T12:00:00.000Z", "oidc": false }
```
