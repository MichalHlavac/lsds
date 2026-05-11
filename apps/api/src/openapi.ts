// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

// OpenAPI 3.1 spec covering the minimum viable surface for design partner integration.
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
    traversalWeight: { type: "number", minimum: 0, exclusiveMinimum: true },
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

const pOffset = {
  name: "offset",
  in: "query",
  schema: { type: "integer", minimum: 0, default: 0 },
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

const nodeResponse     = { $ref: "#/components/schemas/Node" };
const edgeResponse     = { $ref: "#/components/schemas/Edge" };
const violationResponse = { $ref: "#/components/schemas/Violation" };

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
          pOffset,
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data", "total"],
            properties: {
              data:  { type: "array", items: nodeResponse },
              total: { type: "integer" },
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
          pOffset,
        ],
        responses: {
          ...jsonOk({
            type: "object",
            required: ["data", "total"],
            properties: {
              data:  { type: "array", items: edgeResponse },
              total: { type: "integer" },
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
            traversalWeight: { type: "number", exclusiveMinimum: true, minimum: 0, default: 1.0 },
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
            traversalWeight: { type: "number", exclusiveMinimum: true, minimum: 0 },
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
          { name: "resolved", in: "query", schema: { type: "boolean" } },
          pLimit,
          pOffset,
        ],
        responses: {
          "200": { description: "OK", content: { "application/json": { schema: { type: "object", required: ["data"], properties: { data: { type: "array", items: violationResponse } } } } } },
          "401": r401,
        },
      },
    },
  },
} as const;
