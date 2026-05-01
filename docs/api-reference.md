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

## Health

### `GET /health`

Returns API status. No `x-tenant-id` required.

```json
{ "status": "ok", "ts": "2026-05-01T12:00:00.000Z", "oidc": false }
```
