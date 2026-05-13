// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// OpenAPI 3.1 spec covering all published v1 routes.
// Additive: no existing route behaviour is changed. Extend paths/components here only.

const LAYER_ENUM = ["L1", "L2", "L3", "L4", "L5", "L6"] as const;
const LIFECYCLE_STATUS_ENUM = ["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"] as const;
const SEVERITY_ENUM = ["ERROR", "WARN", "INFO"] as const;
const RELATIONSHIP_TYPE_ENUM = [
  "realizes", "implements", "contains", "part-of", "depends-on", "uses",
  "calls", "context-integration", "supersedes", "traces-to", "validated-by",
  "owned-by", "deploys-to", "decided-by", "violates", "motivated-by",
  "impacts", "publishes", "consumes", "covers",
] as const;

// --- reusable schema fragments ---

const sLayer = {
  type: "string",
  enum: [...LAYER_ENUM],
  description: "Architectural layer (L1=Business through L6=Infrastructure)",
};

const sLifecycleStatus = {
  type: "string",
  enum: [...LIFECYCLE_STATUS_ENUM],
};

const sSeverity = {
  type: "string",
  enum: [...SEVERITY_ENUM],
};

const sRelationshipType = {
  type: "string",
  enum: [...RELATIONSHIP_TYPE_ENUM],
  description: "Edge relationship type from the LSDS taxonomy",
};

const sNode = {
  type: "object",
  required: [
    "id", "tenantId", "type", "layer", "name", "version",
    "lifecycleStatus", "attributes", "ownerId", "ownerName",
    "ownerKind", "createdAt", "updatedAt",
  ],
  properties: {
    id:              { type: "string", format: "uuid" },
    tenantId:        { type: "string", format: "uuid" },
    type:            { type: "string" },
    layer:           { $ref: "#/components/schemas/Layer" },
    name:            { type: "string" },
    version:         { type: "string" },
    lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
    attributes:      { type: "object", additionalProperties: true },
    ownerId:         { type: "string" },
    ownerName:       { type: "string" },
    ownerKind:       { type: "string" },
    createdAt:       { type: "string", format: "date-time" },
    updatedAt:       { type: "string", format: "date-time" },
    deprecatedAt:    { type: ["string", "null"], format: "date-time" },
    archivedAt:      { type: ["string", "null"], format: "date-time" },
    purgeAfter:      { type: ["string", "null"], format: "date-time" },
  },
};

const sEdge = {
  type: "object",
  required: [
    "id", "tenantId", "sourceId", "targetId", "type", "layer",
    "traversalWeight", "lifecycleStatus", "attributes", "createdAt", "updatedAt",
  ],
  properties: {
    id:              { type: "string", format: "uuid" },
    tenantId:        { type: "string", format: "uuid" },
    sourceId:        { type: "string", format: "uuid" },
    targetId:        { type: "string", format: "uuid" },
    type:            { $ref: "#/components/schemas/RelationshipType" },
    layer:           { $ref: "#/components/schemas/Layer" },
    traversalWeight: { type: "number", exclusiveMinimum: 0 },
    lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
    attributes:      { type: "object", additionalProperties: true },
    createdAt:       { type: "string", format: "date-time" },
    updatedAt:       { type: "string", format: "date-time" },
    deprecatedAt:    { type: ["string", "null"], format: "date-time" },
    archivedAt:      { type: ["string", "null"], format: "date-time" },
    purgeAfter:      { type: ["string", "null"], format: "date-time" },
  },
};

const sViolation = {
  type: "object",
  required: ["id", "tenantId", "ruleKey", "severity", "message", "resolved", "createdAt", "updatedAt"],
  properties: {
    id:           { type: "string", format: "uuid" },
    tenantId:     { type: "string", format: "uuid" },
    nodeId:       { type: ["string", "null"], format: "uuid" },
    edgeId:       { type: ["string", "null"], format: "uuid" },
    sourceNodeId: { type: ["string", "null"], format: "uuid" },
    targetNodeId: { type: ["string", "null"], format: "uuid" },
    ruleKey:      { type: "string" },
    severity:     { $ref: "#/components/schemas/Severity" },
    message:      { type: "string" },
    attributes:   { type: "object", additionalProperties: true },
    resolved:     { type: "boolean" },
    resolvedAt:   { type: ["string", "null"], format: "date-time" },
    createdAt:    { type: "string", format: "date-time" },
    updatedAt:    { type: "string", format: "date-time" },
  },
};

const sGuardrail = {
  type: "object",
  required: ["id", "tenantId", "ruleKey", "description", "severity", "enabled", "config", "createdAt", "updatedAt"],
  properties: {
    id:          { type: "string", format: "uuid" },
    tenantId:    { type: "string", format: "uuid" },
    ruleKey:     { type: "string" },
    description: { type: "string" },
    severity:    { $ref: "#/components/schemas/Severity" },
    enabled:     { type: "boolean" },
    config:      { type: "object", additionalProperties: true },
    createdAt:   { type: "string", format: "date-time" },
    updatedAt:   { type: "string", format: "date-time" },
  },
};

const sApiKey = {
  type: "object",
  required: ["id", "tenantId", "name", "keyPrefix", "createdAt"],
  properties: {
    id:             { type: "string", format: "uuid" },
    tenantId:       { type: "string", format: "uuid" },
    name:           { type: "string" },
    keyPrefix:      { type: "string" },
    createdAt:      { type: "string", format: "date-time" },
    revokedAt:      { type: ["string", "null"], format: "date-time" },
    expiresAt:      { type: ["string", "null"], format: "date-time" },
    rateLimitRpm:   { type: ["integer", "null"], minimum: 1 },
    rateLimitBurst: { type: ["integer", "null"], minimum: 1 },
  },
};

const sAuditLogEntry = {
  type: "object",
  required: ["id", "tenantId", "operation", "entityType", "entityId", "createdAt"],
  properties: {
    id:         { type: "string", format: "uuid" },
    tenantId:   { type: "string", format: "uuid" },
    apiKeyId:   { type: ["string", "null"], format: "uuid" },
    operation:  {
      type: "string",
      enum: [
        "node.create", "node.update", "node.delete",
        "node.deprecate", "node.archive", "node.purge",
        "edge.create", "edge.update", "edge.delete",
        "edge.deprecate", "edge.archive", "edge.purge",
        "rate_limit_hit",
      ],
    },
    entityType: { type: "string" },
    entityId:   { type: "string", format: "uuid" },
    diff:       { type: ["object", "null"], additionalProperties: true },
    createdAt:  { type: "string", format: "date-time" },
  },
};

const sError = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string" },
  },
};

// --- common parameter and response helpers ---

const pId = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
};

const pLimit = {
  name: "limit",
  in: "query",
  schema: { type: "integer", minimum: 1, maximum: 500, default: 50 },
};

const pCursor = {
  name: "cursor",
  in: "query",
  schema: { type: "string" },
  description: "Opaque cursor token returned as nextCursor from a previous page. Omit for the first page.",
};

const pCount = {
  name: "count",
  in: "query",
  schema: { type: "boolean", default: false },
  description: "When true, fires COUNT(*) and includes totalCount in the response.",
};

const r400 = { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const r401 = { description: "Unauthorized",     content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const r404 = { description: "Not found",        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const r409 = { description: "Conflict",         content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };
const r422 = { description: "Business rule violation", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } };

const tenantSecurity = [{ TenantApiKey: [], TenantId: [] }];
const adminSecurity  = [{ AdminBearer: [] }];
const noSecurity     = [] as const;

const jsonBody = (schema: object) => ({
  required: true,
  content: { "application/json": { schema } },
});

const jsonOk = (schema: object, status = "200") => ({
  [status]: {
    description: "OK",
    content: { "application/json": { schema } },
  },
});

const nodeResponse      = { $ref: "#/components/schemas/Node" };
const edgeResponse      = { $ref: "#/components/schemas/Edge" };
const violationResponse = { $ref: "#/components/schemas/Violation" };
const guardrailResponse = { $ref: "#/components/schemas/Guardrail" };
const apiKeyResponse    = { $ref: "#/components/schemas/ApiKey" };

// --- spec ---

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "LSDS API",
    version: "0.0.0",
    description: [
      "Layered Software Design System — machine-readable API for design partner integration.",
      "All /v1 routes require X-Api-Key + X-Tenant-Id headers.",
      "Admin routes require an Authorization: Bearer <secret> header.",
    ].join(" "),
    license: { name: "BUSL-1.1", url: "https://mariadb.com/bsl11/" },
  },
  servers: [{ url: "/" }],

  components: {
    securitySchemes: {
      TenantApiKey: {
        type: "apiKey",
        in: "header",
        name: "X-Api-Key",
        description: "Tenant API key (prefix + secret). Obtain via POST /api/admin/tenants.",
      },
      TenantId: {
        type: "apiKey",
        in: "header",
        name: "X-Tenant-Id",
        description: "Tenant UUID. Must accompany every TenantApiKey request.",
      },
      AdminBearer: {
        type: "http",
        scheme: "bearer",
        description: "Server-side admin secret (ADMIN_SECRET env var).",
      },
    },
    schemas: {
      Layer:            sLayer,
      LifecycleStatus:  sLifecycleStatus,
      Severity:         sSeverity,
      RelationshipType: sRelationshipType,
      Node:             sNode,
      Edge:             sEdge,
      Violation:        sViolation,
      Guardrail:        sGuardrail,
      ApiKey:           sApiKey,
      AuditLogEntry:    sAuditLogEntry,
      Error:            sError,
    },
  },

  paths: {
    // ── Health ─────────────────────────────────────────────────────────────

    "/health/live": {
      get: {
        operationId: "healthLive",
        tags: ["Health"],
        summary: "Liveness probe",
        description: "Always returns 200 if the process is running. Safe to call without credentials.",
        security: noSecurity,
        responses: {
          "200": {
            description: "Process is alive",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "ts"],
                  properties: {
                    status: { type: "string", enum: ["alive"] },
                    ts:     { type: "string", format: "date-time" },
                  },
                },
              },
            },
          },
        },
      },
    },

    "/health/ready": {
      get: {
        operationId: "healthReady",
        tags: ["Health"],
        summary: "Readiness probe",
        description: "Returns 200 when DB is reachable and all required migrations are applied; 503 otherwise.",
        security: noSecurity,
        responses: {
          "200": {
            description: "Service is ready",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["status", "db", "migrations", "ts"],
                  properties: {
                    status:     { type: "string", enum: ["ready"] },
                    migrations: { type: "string", enum: ["current"] },
                    ts:         { type: "string", format: "date-time" },
                    db: {
                      type: "object",
                      required: ["poolSize", "idleCount", "waitingCount"],
                      properties: {
                        poolSize:     { type: "integer" },
                        idleCount:    { type: "integer" },
                        waitingCount: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "503": {
            description: "Service is not ready (DB unreachable or migrations pending)",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },

    "/api/openapi.json": {
      get: {
        operationId: "getOpenApiSpec",
        tags: ["Meta"],
        summary: "OpenAPI 3.1 specification",
        description: "Returns this spec. Unauthenticated. Use for SDK generation and integration testing.",
        security: noSecurity,
        responses: {
          "200": {
            description: "OpenAPI 3.1 document",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },

    // ── Admin ───────────────────────────────────────────────────────────────

    "/api/admin/tenants": {
      post: {
        operationId: "adminCreateTenant",
        tags: ["Admin"],
        summary: "Create tenant",
        description: "Creates a new tenant and returns a bootstrap API key (shown once — store it).",
        security: adminSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["name", "slug", "plan"],
          properties: {
            name: { type: "string", minLength: 1, maxLength: 200 },
            slug: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^[a-z0-9-]+$",
              description: "Lowercase alphanumeric with hyphens. Must be globally unique.",
            },
            plan: { type: "string", enum: ["trial", "partner"] },
          },
        }),
        responses: {
          "201": {
            description: "Tenant created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["tenant", "apiKey"],
                      properties: {
                        tenant: {
                          type: "object",
                          required: ["id", "name", "slug", "plan", "created_at"],
                          properties: {
                            id:         { type: "string", format: "uuid" },
                            name:       { type: "string" },
                            slug:       { type: "string" },
                            plan:       { type: "string" },
                            created_at: { type: "string", format: "date-time" },
                          },
                        },
                        apiKey: {
                          type: "object",
                          required: ["id", "key_prefix", "created_at", "key"],
                          properties: {
                            id:         { type: "string", format: "uuid" },
                            key_prefix: { type: "string" },
                            created_at: { type: "string", format: "date-time" },
                            key:        { type: "string", description: "Full plaintext API key — store now, never shown again." },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
          "409": r409,
        },
      },
    },

    "/api/admin/tenants/{tenantId}/api-keys": {
      patch: {
        operationId: "adminRotateTenantApiKeys",
        tags: ["Admin"],
        summary: "Rotate tenant API keys",
        description: "Revokes all active API keys for the tenant and issues a new one.",
        security: adminSecurity,
        parameters: [{ name: "tenantId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "New API key issued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["id", "key_prefix", "created_at", "key"],
                      properties: {
                        id:         { type: "string", format: "uuid" },
                        key_prefix: { type: "string" },
                        created_at: { type: "string", format: "date-time" },
                        key:        { type: "string", description: "Full plaintext API key — store now, never shown again." },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": r401,
          "404": r404,
        },
      },
    },

    "/api/admin/diagnostics": {
      get: {
        operationId: "adminDiagnostics",
        tags: ["Admin"],
        summary: "System-wide diagnostics bundle",
        description: [
          "Returns a cross-tenant system snapshot for support triage.",
          "Includes process info (version, uptime, memory), DB connectivity, pool size, and aggregate counts.",
          "Response is cached for 30 seconds.",
        ].join(" "),
        security: adminSecurity,
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: [
                        "appVersion", "nodeVersion", "uptime", "memory",
                        "dbConnected", "dbPoolSize",
                        "totalTenants", "totalActiveApiKeys", "totalNodes", "totalEdges",
                        "generatedAt",
                      ],
                      properties: {
                        appVersion:         { type: "string", description: "Value of APP_VERSION env var, or 'unknown'" },
                        nodeVersion:        { type: "string", description: "process.version" },
                        uptime:             { type: "number", description: "Process uptime in seconds" },
                        memory: {
                          type: "object",
                          required: ["rss", "heapTotal", "heapUsed", "external"],
                          properties: {
                            rss:       { type: "integer" },
                            heapTotal: { type: "integer" },
                            heapUsed:  { type: "integer" },
                            external:  { type: "integer" },
                          },
                        },
                        dbConnected:        { type: "boolean", description: "False when DB query fails" },
                        dbPoolSize:         { type: "integer", description: "Configured max pool size" },
                        totalTenants:       { type: "integer", minimum: 0 },
                        totalActiveApiKeys: { type: "integer", minimum: 0, description: "Non-revoked, non-expired API keys across all tenants" },
                        totalNodes:         { type: "integer", minimum: 0 },
                        totalEdges:         { type: "integer", minimum: 0 },
                        generatedAt:        { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": r401,
        },
      },
    },

    // ── Nodes ───────────────────────────────────────────────────────────────

    "/v1/nodes": {
      get: {
        operationId: "listNodes",
        tags: ["Nodes"],
        summary: "List nodes",
        security: tenantSecurity,
        parameters: [
          { name: "q",               in: "query", schema: { type: "string" }, description: "Full-text search on name and type" },
          { name: "type",            in: "query", schema: { type: "string" } },
          { name: "layer",           in: "query", schema: { $ref: "#/components/schemas/Layer" } },
          { name: "lifecycleStatus", in: "query", schema: { $ref: "#/components/schemas/LifecycleStatus" } },
          { name: "includeArchived", in: "query", schema: { type: "boolean", default: false } },
          { name: "sortBy",          in: "query", schema: { type: "string", enum: ["name", "createdAt", "updatedAt", "type", "layer", "lifecycleStatus"] } },
          { name: "order",           in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
          pLimit,
          pCursor,
          pCount,
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data", "nextCursor"],
            properties: {
              data:       { type: "array", items: nodeResponse },
              nextCursor: { type: "string", nullable: true },
              totalCount: { type: "integer", description: "Only present when ?count=true" },
            },
          }),
          "401": r401,
        },
      },

      post: {
        operationId: "createNode",
        tags: ["Nodes"],
        summary: "Create node",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["type", "layer", "name"],
          properties: {
            type:            { type: "string", minLength: 1 },
            layer:           { $ref: "#/components/schemas/Layer" },
            name:            { type: "string", minLength: 1 },
            version:         { type: "string", default: "0.1.0" },
            lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
            attributes:      { type: "object", additionalProperties: true, default: {} },
            owner: {
              type: "object",
              properties: {
                id:   { type: "string" },
                name: { type: "string" },
              },
            },
          },
        }),
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "400": r400,
          "401": r401,
          "409": r409,
        },
      },
    },

    "/v1/nodes/search": {
      get: {
        operationId: "searchNodes",
        tags: ["Nodes"],
        summary: "Search nodes by JSONB attributes",
        description: "Returns nodes whose attributes object contains all key/value pairs in the `attributes` filter (PostgreSQL @> operator).",
        security: tenantSecurity,
        parameters: [
          {
            name: "attributes",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "URL-encoded JSON object of attribute key/value pairs to match against.",
          },
          { name: "type",  in: "query", schema: { type: "string" } },
          pLimit,
        ],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "array", items: nodeResponse } } } } } },
          "400": r400,
          "401": r401,
        },
      },
    },

    "/v1/nodes/similar": {
      post: {
        operationId: "similarNodes",
        tags: ["Nodes"],
        summary: "Find similar nodes by embedding",
        description: "Cosine-similarity nearest-neighbour search over node vector embeddings.",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["nodeId"],
          properties: {
            nodeId:    { type: "string", format: "uuid" },
            topK:      { type: "integer", minimum: 1, maximum: 100, default: 10 },
            threshold: { type: "number", minimum: 0, maximum: 1 },
            model:     { type: "string" },
          },
        }),
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["node", "score"],
                        properties: {
                          node:  { $ref: "#/components/schemas/Node" },
                          score: { type: "number", minimum: 0, maximum: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
          "404": r404,
          "422": r422,
        },
      },
    },

    "/v1/nodes/{id}": {
      get: {
        operationId: "getNode",
        tags: ["Nodes"],
        summary: "Get node by ID",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "401": r401,
          "404": r404,
        },
      },

      patch: {
        operationId: "updateNode",
        tags: ["Nodes"],
        summary: "Update node",
        description: "Updates mutable fields. `type` and `layer` are immutable after creation.",
        security: tenantSecurity,
        parameters: [pId],
        requestBody: jsonBody({
          type: "object",
          properties: {
            name:            { type: "string", minLength: 1 },
            version:         { type: "string" },
            lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
            attributes:      { type: "object", additionalProperties: true },
          },
        }),
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
          "422": r422,
        },
      },

      delete: {
        operationId: "deleteNode",
        tags: ["Nodes"],
        summary: "Purge node",
        description: "Permanently deletes a node. The node must be ARCHIVED and its retention period elapsed.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Purged",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } } } },
          },
          "401": r401,
          "404": r404,
          "422": r422,
        },
      },
    },

    // ── Node Traversal ───────────────────────────────────────────────────────

    "/v1/nodes/{id}/traverse": {
      post: {
        operationId: "traverseNode",
        tags: ["Traversal"],
        summary: "Traverse graph from a node",
        description: [
          "Walks the graph from the given node using a recursive CTE.",
          "Returns the traversed node IDs with depth metadata and the full Node objects.",
          "Results are cached per (tenant, nodeId, depth, direction, edgeTypes) for 5 minutes.",
        ].join(" "),
        security: tenantSecurity,
        parameters: [pId],
        requestBody: jsonBody({
          type: "object",
          properties: {
            depth:     { type: "integer", minimum: 1, maximum: 20, default: 3 },
            direction: { type: "string", enum: ["outbound", "inbound", "both"], default: "both" },
            edgeTypes: {
              type: "array",
              items: { $ref: "#/components/schemas/RelationshipType" },
              description: "Filter traversal to these edge types. Omit to traverse all types.",
            },
          },
        }),
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data", "cached"],
                  properties: {
                    cached: { type: "boolean" },
                    data: {
                      type: "object",
                      required: ["root", "depth", "direction", "nodes", "traversal"],
                      properties: {
                        root:      { type: "string", format: "uuid" },
                        depth:     { type: "integer" },
                        direction: { type: "string", enum: ["outbound", "inbound", "both"] },
                        nodes:     { type: "array", items: { $ref: "#/components/schemas/Node" } },
                        traversal: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["nodeId", "depth"],
                            properties: {
                              nodeId: { type: "string", format: "uuid" },
                              depth:  { type: "integer", minimum: 0 },
                            },
                            additionalProperties: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── Edges ───────────────────────────────────────────────────────────────

    "/v1/edges": {
      get: {
        operationId: "listEdges",
        tags: ["Edges"],
        summary: "List edges",
        security: tenantSecurity,
        parameters: [
          { name: "q",               in: "query", schema: { type: "string" }, description: "Filter by type substring" },
          { name: "sourceId",        in: "query", schema: { type: "string", format: "uuid" } },
          { name: "targetId",        in: "query", schema: { type: "string", format: "uuid" } },
          { name: "type",            in: "query", schema: { $ref: "#/components/schemas/RelationshipType" } },
          { name: "lifecycleStatus", in: "query", schema: { $ref: "#/components/schemas/LifecycleStatus" } },
          { name: "includeArchived", in: "query", schema: { type: "boolean", default: false } },
          { name: "sortBy",          in: "query", schema: { type: "string", enum: ["createdAt", "updatedAt", "type", "layer", "traversalWeight"] } },
          { name: "order",           in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
          pLimit,
          pCursor,
          pCount,
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data", "nextCursor"],
            properties: {
              data:       { type: "array", items: edgeResponse },
              nextCursor: { type: "string", nullable: true },
              totalCount: { type: "integer", description: "Only present when ?count=true" },
            },
          }),
          "401": r401,
        },
      },

      post: {
        operationId: "createEdge",
        tags: ["Edges"],
        summary: "Create edge",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["sourceId", "targetId", "type", "layer"],
          properties: {
            sourceId:        { type: "string", format: "uuid" },
            targetId:        { type: "string", format: "uuid" },
            type:            { $ref: "#/components/schemas/RelationshipType" },
            layer:           { $ref: "#/components/schemas/Layer" },
            traversalWeight: { type: "number", exclusiveMinimum: 0, default: 1.0 },
            attributes:      { type: "object", additionalProperties: true, default: {} },
          },
        }),
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: edgeResponse } } } } },
          "400": r400,
          "401": r401,
          "409": r409,
        },
      },
    },

    "/v1/edges/{id}": {
      get: {
        operationId: "getEdge",
        tags: ["Edges"],
        summary: "Get edge by ID",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: edgeResponse } } } } },
          "401": r401,
          "404": r404,
        },
      },

      patch: {
        operationId: "updateEdge",
        tags: ["Edges"],
        summary: "Update edge",
        security: tenantSecurity,
        parameters: [pId],
        requestBody: jsonBody({
          type: "object",
          properties: {
            type:            { type: "string", minLength: 1 },
            traversalWeight: { type: "number", exclusiveMinimum: 0 },
            attributes:      { type: "object", additionalProperties: true },
          },
        }),
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: edgeResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },

      delete: {
        operationId: "deleteEdge",
        tags: ["Edges"],
        summary: "Purge edge",
        description: "Permanently deletes an edge. The edge must be ARCHIVED and its retention period elapsed.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Purged",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } } } },
          },
          "401": r401,
          "404": r404,
          "422": r422,
        },
      },
    },

    // ── Lifecycle ────────────────────────────────────────────────────────────

    "/v1/lifecycle/nodes/{id}/deprecate": {
      post: {
        operationId: "deprecateNode",
        tags: ["Lifecycle"],
        summary: "Deprecate node",
        description: "Transitions node from ACTIVE to DEPRECATED. Attributes become immutable after this point.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    "/v1/lifecycle/nodes/{id}/archive": {
      post: {
        operationId: "archiveNode",
        tags: ["Lifecycle"],
        summary: "Archive node",
        description: "Transitions node from DEPRECATED to ARCHIVED. Starts the retention clock.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    "/v1/lifecycle/nodes/{id}/mark-purge": {
      post: {
        operationId: "markNodeForPurge",
        tags: ["Lifecycle"],
        summary: "Mark node for purge",
        description: "Schedules an ARCHIVED node for purge, optionally overriding the retention window.",
        security: tenantSecurity,
        parameters: [pId],
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  purgeAfterDays: { type: "integer", minimum: 0, description: "Override tenant retention period (days)." },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: nodeResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    "/v1/lifecycle/nodes/{id}/purge": {
      delete: {
        operationId: "purgeNode",
        tags: ["Lifecycle"],
        summary: "Immediately purge node",
        description: "Permanently deletes the node without waiting for the retention window.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Purged",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id", "purged"], properties: { id: { type: "string", format: "uuid" }, purged: { type: "boolean" } } } } } } },
          },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── Violations ───────────────────────────────────────────────────────────

    "/v1/violations": {
      get: {
        operationId: "listViolations",
        tags: ["Violations"],
        summary: "List violations",
        security: tenantSecurity,
        parameters: [
          { name: "nodeId",   in: "query", schema: { type: "string", format: "uuid" } },
          { name: "ruleKey",  in: "query", schema: { type: "string" } },
          { name: "severity", in: "query", schema: { $ref: "#/components/schemas/Severity" } },
          { name: "resolved", in: "query", schema: { type: "boolean" } },
          pLimit,
          pCursor,
          pCount,
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data", "nextCursor"],
            properties: {
              data:       { type: "array", items: violationResponse },
              nextCursor: { type: "string", nullable: true },
              totalCount: { type: "integer", description: "Only present when ?count=true" },
            },
          }),
          "401": r401,
        },
      },

      post: {
        operationId: "createViolation",
        tags: ["Violations"],
        summary: "Create violation",
        description: "Records a guardrail violation. At least one of nodeId or edgeId should be provided.",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["ruleKey", "severity", "message"],
          properties: {
            nodeId:       { type: "string", format: "uuid" },
            edgeId:       { type: "string", format: "uuid" },
            sourceNodeId: { type: "string", format: "uuid" },
            targetNodeId: { type: "string", format: "uuid" },
            ruleKey:      { type: "string", minLength: 1 },
            severity:     { $ref: "#/components/schemas/Severity" },
            message:      { type: "string", minLength: 1 },
            attributes:   { type: "object", additionalProperties: true, default: {} },
          },
        }),
        responses: {
          "201": { description: "Created", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: violationResponse } } } } },
          "400": r400,
          "401": r401,
        },
      },
    },

    "/v1/violations/batch-resolve": {
      post: {
        operationId: "batchResolveViolations",
        tags: ["Violations"],
        summary: "Batch resolve violations",
        description: "Resolves multiple violations in a single operation. Returns 207 if some IDs were not found or already resolved.",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["ids"],
          properties: {
            ids: { type: "array", items: { type: "string", format: "uuid" }, minItems: 1 },
          },
        }),
        responses: {
          "200": {
            description: "All violations resolved",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["succeeded", "failed"],
                      properties: {
                        succeeded: { type: "array", items: violationResponse },
                        failed: {
                          type: "array",
                          items: {
                            type: "object",
                            required: ["id", "error"],
                            properties: {
                              id:    { type: "string", format: "uuid" },
                              error: { type: "string" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "207": { description: "Partial success — check failed array" },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    "/v1/violations/{id}": {
      get: {
        operationId: "getViolation",
        tags: ["Violations"],
        summary: "Get violation by ID",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: violationResponse } } } } },
          "401": r401,
          "404": r404,
        },
      },

      delete: {
        operationId: "deleteViolation",
        tags: ["Violations"],
        summary: "Delete violation",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Deleted",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } } } },
          },
          "401": r401,
          "404": r404,
        },
      },
    },

    "/v1/violations/{id}/resolve": {
      post: {
        operationId: "resolveViolation",
        tags: ["Violations"],
        summary: "Resolve violation",
        description: "Marks a single violation as resolved. Returns 404 if not found or already resolved.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: violationResponse } } } } },
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── Guardrails ───────────────────────────────────────────────────────────

    "/v1/guardrails": {
      get: {
        operationId: "listGuardrails",
        tags: ["Guardrails"],
        summary: "List guardrail rules",
        description: "Returns all guardrail rules for the tenant, optionally filtered by enabled state.",
        security: tenantSecurity,
        parameters: [
          { name: "enabled", in: "query", schema: { type: "boolean" }, description: "Filter to only enabled or only disabled rules." },
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data"],
            properties: {
              data: { type: "array", items: guardrailResponse },
            },
          }),
          "401": r401,
        },
      },

      post: {
        operationId: "upsertGuardrail",
        tags: ["Guardrails"],
        summary: "Create or update guardrail rule",
        description: "Creates a new guardrail rule, or updates it if a rule with the same ruleKey already exists (upsert by ruleKey).",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["ruleKey", "severity"],
          properties: {
            ruleKey:     { type: "string", minLength: 1 },
            description: { type: "string", default: "" },
            severity:    { $ref: "#/components/schemas/Severity" },
            enabled:     { type: "boolean", default: true },
            config:      { type: "object", additionalProperties: true, default: {} },
          },
        }),
        responses: {
          "201": { description: "Created or updated", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: guardrailResponse } } } } },
          "400": r400,
          "401": r401,
        },
      },
    },

    "/v1/guardrails/{id}": {
      get: {
        operationId: "getGuardrail",
        tags: ["Guardrails"],
        summary: "Get guardrail rule by ID",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: guardrailResponse } } } } },
          "401": r401,
          "404": r404,
        },
      },

      patch: {
        operationId: "updateGuardrail",
        tags: ["Guardrails"],
        summary: "Update guardrail rule",
        security: tenantSecurity,
        parameters: [pId],
        requestBody: jsonBody({
          type: "object",
          properties: {
            description: { type: "string" },
            severity:    { $ref: "#/components/schemas/Severity" },
            enabled:     { type: "boolean" },
            config:      { type: "object", additionalProperties: true },
          },
        }),
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: guardrailResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },

      delete: {
        operationId: "deleteGuardrail",
        tags: ["Guardrails"],
        summary: "Delete guardrail rule",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Deleted",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } } } },
          },
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── API Keys ─────────────────────────────────────────────────────────────

    "/v1/api-keys": {
      get: {
        operationId: "listApiKeys",
        tags: ["API Keys"],
        summary: "List API keys",
        description: "Returns all API keys (active and revoked) for the tenant. Key hashes are never exposed.",
        security: tenantSecurity,
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data"],
            properties: {
              data: { type: "array", items: apiKeyResponse },
            },
          }),
          "401": r401,
        },
      },

      post: {
        operationId: "createApiKey",
        tags: ["API Keys"],
        summary: "Create API key",
        description: "Issues a new API key. The plaintext key is returned once — store it immediately.",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["name"],
          properties: {
            name:           { type: "string", minLength: 1, maxLength: 200 },
            rateLimitRpm:   { type: ["integer", "null"], minimum: 1 },
            rateLimitBurst: { type: ["integer", "null"], minimum: 1 },
          },
        }),
        responses: {
          "201": {
            description: "Created — plaintext key shown once",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      allOf: [
                        { $ref: "#/components/schemas/ApiKey" },
                        {
                          type: "object",
                          required: ["key"],
                          properties: {
                            key: { type: "string", description: "Full plaintext API key — store now, never shown again." },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
        },
      },
    },

    "/v1/api-keys/{id}": {
      delete: {
        operationId: "revokeApiKey",
        tags: ["API Keys"],
        summary: "Revoke API key",
        description: "Revokes the key by setting revokedAt. Revoked keys are rejected on all subsequent requests.",
        security: tenantSecurity,
        parameters: [pId],
        responses: {
          "200": {
            description: "Revoked",
            content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } } } },
          },
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── Tenant API Key Management ─────────────────────────────────────────────

    "/v1/tenant/api-keys": {
      get: {
        operationId: "listTenantApiKeys",
        tags: ["Tenant"],
        summary: "List active API keys",
        description: "Returns all non-revoked API keys for the authenticated tenant. The key secret is never returned.",
        security: tenantSecurity,
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["id", "tenant_id", "name", "key_prefix", "created_at", "revoked_at", "expires_at", "rate_limit_rpm", "rate_limit_burst"],
                        properties: {
                          id:               { type: "string", format: "uuid" },
                          tenant_id:        { type: "string", format: "uuid" },
                          name:             { type: "string" },
                          key_prefix:       { type: "string" },
                          created_at:       { type: "string", format: "date-time" },
                          revoked_at:       { type: ["string", "null"], format: "date-time" },
                          expires_at:       { type: ["string", "null"], format: "date-time" },
                          rate_limit_rpm:   { type: ["integer", "null"], minimum: 1 },
                          rate_limit_burst: { type: ["integer", "null"], minimum: 1 },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": r401,
        },
      },
    },

    "/v1/tenant/api-keys/rotate": {
      post: {
        operationId: "rotateTenantApiKeys",
        tags: ["Tenant"],
        summary: "Rotate tenant API keys",
        description: "Revokes all active API keys for the tenant and issues one new key in a single transaction.",
        security: tenantSecurity,
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string", minLength: 1, maxLength: 200, description: "Name for the new key. Defaults to 'Rotated key'." },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Rotated — new plaintext key shown once",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      allOf: [
                        { $ref: "#/components/schemas/ApiKey" },
                        {
                          type: "object",
                          required: ["key"],
                          properties: {
                            key: { type: "string", description: "Full plaintext API key — store now, never shown again." },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
        },
      },
    },

    "/v1/tenant/api-keys/{keyId}": {
      patch: {
        operationId: "updateTenantApiKey",
        tags: ["Tenant"],
        summary: "Update API key settings",
        description: "Updates expiry and/or per-key rate limits. Only active (non-revoked) keys can be patched.",
        security: tenantSecurity,
        parameters: [{ name: "keyId", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        requestBody: jsonBody({
          type: "object",
          properties: {
            expiresAt:      { type: ["string", "null"], format: "date-time" },
            rateLimitRpm:   { type: ["integer", "null"], minimum: 1 },
            rateLimitBurst: { type: ["integer", "null"], minimum: 1 },
          },
          description: "At least one field must be provided.",
        }),
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: apiKeyResponse } } } } },
          "400": r400,
          "401": r401,
          "404": r404,
        },
      },
    },

    // ── Tenant diagnostics ───────────────────────────────────────────────────

    "/v1/tenant/diagnostics": {
      get: {
        operationId: "getTenantDiagnostics",
        tags: ["Tenant"],
        summary: "Tenant diagnostics snapshot",
        description: [
          "Returns a redacted health snapshot for on-prem support workflows.",
          "Counts only — no content, no labels, no PII.",
          "Scoped to the calling tenant.",
        ].join(" "),
        security: tenantSecurity,
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: [
                        "appVersion", "nodeCount", "edgeCount", "apiKeyCount",
                        "webhookEndpointCount", "auditLogEntries", "lastMutationAt", "dbConnected",
                      ],
                      properties: {
                        appVersion:            { type: "string", description: "Value of APP_VERSION env var, or 'unknown'" },
                        nodeCount:             { type: "integer", minimum: 0 },
                        edgeCount:             { type: "integer", minimum: 0 },
                        apiKeyCount:           { type: "integer", minimum: 0, description: "Active (non-revoked, non-expired) API keys" },
                        webhookEndpointCount:  { type: "integer", minimum: 0, description: "Active webhook endpoints" },
                        auditLogEntries:       { type: "integer", minimum: 0 },
                        lastMutationAt:        { type: ["string", "null"], format: "date-time", description: "max changed_at from node_history, null if empty" },
                        dbConnected:           { type: "boolean" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": r401,
        },
      },
    },

    // ── Export ───────────────────────────────────────────────────────────────

    "/v1/export": {
      get: {
        operationId: "exportGraph",
        tags: ["Export / Import"],
        summary: "Full graph export (NDJSON)",
        description: [
          "Streams all nodes then all edges for the tenant as newline-delimited JSON (NDJSON).",
          "Each line is a self-contained JSON object with a 'type' discriminator ('node' or 'edge').",
          "Edges are guaranteed to appear after all nodes so sourceId/targetId always resolve earlier in the stream.",
          "Optionally filter by lifecycleStatus and/or layer.",
        ].join(" "),
        security: tenantSecurity,
        parameters: [
          { name: "lifecycleStatus", in: "query", schema: { $ref: "#/components/schemas/LifecycleStatus" } },
          { name: "layer",           in: "query", schema: { $ref: "#/components/schemas/Layer" } },
        ],
        responses: {
          "200": {
            description: "NDJSON stream — one record per line",
            content: {
              "application/x-ndjson": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      required: ["type", "id", "layer", "nodeType", "name", "version", "lifecycleStatus", "attributes", "createdAt"],
                      properties: {
                        type:            { type: "string", enum: ["node"] },
                        id:              { type: "string", format: "uuid" },
                        layer:           { $ref: "#/components/schemas/Layer" },
                        nodeType:        { type: "string" },
                        name:            { type: "string" },
                        version:         { type: "string" },
                        lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
                        attributes:      { type: "object", additionalProperties: true },
                        createdAt:       { type: "string", format: "date-time" },
                      },
                    },
                    {
                      type: "object",
                      required: ["type", "id", "sourceId", "targetId", "edgeType", "layer", "traversalWeight", "lifecycleStatus", "attributes", "createdAt"],
                      properties: {
                        type:            { type: "string", enum: ["edge"] },
                        id:              { type: "string", format: "uuid" },
                        sourceId:        { type: "string", format: "uuid" },
                        targetId:        { type: "string", format: "uuid" },
                        edgeType:        { type: "string" },
                        layer:           { $ref: "#/components/schemas/Layer" },
                        traversalWeight: { type: "number" },
                        lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
                        attributes:      { type: "object", additionalProperties: true },
                        createdAt:       { type: "string", format: "date-time" },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": r400,
          "401": r401,
        },
      },
    },

    // ── Import ───────────────────────────────────────────────────────────────

    "/v1/import/bulk": {
      post: {
        operationId: "bulkImport",
        tags: ["Export / Import"],
        summary: "Bulk import nodes and edges",
        description: [
          "Atomically imports up to 50,000 nodes and edges in a single transaction.",
          "Edges are validated against cross-layer guardrails before insertion.",
          "All items must be new — duplicate (type, layer, name) for nodes or (sourceId, targetId, type) for edges returns 409.",
          "Fires an import.completed webhook after the transaction commits (best-effort).",
        ].join(" "),
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          required: ["nodes"],
          properties: {
            nodes: {
              type: "array",
              items: {
                type: "object",
                required: ["type", "layer", "name"],
                properties: {
                  type:            { type: "string", minLength: 1 },
                  layer:           { $ref: "#/components/schemas/Layer" },
                  name:            { type: "string", minLength: 1 },
                  version:         { type: "string", default: "0.1.0" },
                  lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
                  attributes:      { type: "object", additionalProperties: true, default: {} },
                  owner: {
                    type: "object",
                    properties: {
                      id:   { type: "string" },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            edges: {
              type: "array",
              default: [],
              items: {
                type: "object",
                required: ["sourceId", "targetId", "type", "layer"],
                properties: {
                  sourceId:        { type: "string", format: "uuid" },
                  targetId:        { type: "string", format: "uuid" },
                  type:            { $ref: "#/components/schemas/RelationshipType" },
                  layer:           { $ref: "#/components/schemas/Layer" },
                  traversalWeight: { type: "number", exclusiveMinimum: 0, default: 1.0 },
                  attributes:      { type: "object", additionalProperties: true, default: {} },
                },
              },
            },
          },
        }),
        responses: {
          "201": {
            description: "Import completed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["data"],
                  properties: {
                    data: {
                      type: "object",
                      required: ["created", "errors"],
                      properties: {
                        created: {
                          type: "object",
                          required: ["nodes", "edges"],
                          properties: {
                            nodes: { type: "array", items: { type: "string", format: "uuid" } },
                            edges: { type: "array", items: { type: "string", format: "uuid" } },
                          },
                        },
                        errors: { type: "array", items: { type: "object", additionalProperties: true } },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
          "409": r409,
          "422": r422,
        },
      },
    },

    // ── Query ────────────────────────────────────────────────────────────────

    "/v1/query/nodes": {
      post: {
        operationId: "queryNodes",
        tags: ["Query"],
        summary: "Structured node query",
        description: "Flexible server-side filter combining type, layer, lifecycleStatus, attribute containment, and free-text search.",
        security: tenantSecurity,
        requestBody: jsonBody({
          type: "object",
          properties: {
            type:            { type: "string", minLength: 1 },
            layer:           { $ref: "#/components/schemas/Layer" },
            lifecycleStatus: { $ref: "#/components/schemas/LifecycleStatus" },
            attributes:      { type: "object", additionalProperties: true, description: "Containment filter (PostgreSQL @> operator)." },
            text:            { type: "string", description: "Case-insensitive substring match on name and type." },
            limit:           { type: "integer", minimum: 1, maximum: 500, default: 50 },
            offset:          { type: "integer", minimum: 0, default: 0 },
          },
        }),
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data"],
            properties: {
              data: { type: "array", items: nodeResponse },
            },
          }),
          "400": r400,
          "401": r401,
        },
      },
    },

    // ── Audit Log ────────────────────────────────────────────────────────────

    "/v1/audit-log": {
      get: {
        operationId: "listAuditLog",
        tags: ["Audit Log"],
        summary: "List audit log entries",
        description: [
          "Returns audit log entries for the tenant in reverse chronological order.",
          "Cursor-paginated: pass the nextCursor from the previous response as the cursor query parameter.",
          "Audit log is append-only — DELETE and PATCH are rejected with 405.",
        ].join(" "),
        security: tenantSecurity,
        parameters: [
          { name: "entity_id",   in: "query", schema: { type: "string", format: "uuid" }, description: "Filter to a specific entity (node or edge) by ID." },
          { name: "entity_type", in: "query", schema: { type: "string" }, description: "Filter by entity type string (e.g. 'Service', 'Database')." },
          {
            name: "operation",
            in: "query",
            schema: {
              type: "string",
              enum: [
                "node.create", "node.update", "node.delete",
                "node.deprecate", "node.archive", "node.purge",
                "edge.create", "edge.update", "edge.delete",
                "edge.deprecate", "edge.archive", "edge.purge",
                "rate_limit_hit",
              ],
            },
          },
          { name: "from",   in: "query", schema: { type: "string", format: "date-time" }, description: "Return only entries at or after this timestamp." },
          { name: "to",     in: "query", schema: { type: "string", format: "date-time" }, description: "Return only entries at or before this timestamp." },
          { name: "cursor", in: "query", schema: { type: "string" }, description: "Opaque cursor from a previous response's nextCursor field." },
          { name: "limit",  in: "query", schema: { type: "integer", minimum: 1, maximum: 200, default: 50 } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["items", "nextCursor"],
                  properties: {
                    items:      { type: "array", items: { $ref: "#/components/schemas/AuditLogEntry" } },
                    nextCursor: { type: ["string", "null"], description: "Pass as cursor in the next request to get the following page. Null means no more pages." },
                  },
                },
              },
            },
          },
          "400": r400,
          "401": r401,
        },
      },
    },
  },
} as const;
