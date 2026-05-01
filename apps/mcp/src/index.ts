#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createLsdsClient, getConfigFromEnv, LifecycleTransitionApiError } from "./client.js";

const config = getConfigFromEnv();
const client = createLsdsClient(config);

const server = new McpServer({
  name: "lsds",
  version: "0.1.0",
});

// ── Knowledge Agent tools ────────────────────────────────────────────────────

server.tool(
  "lsds_get_context",
  "Get the full context package for a knowledge graph node assembled by the traversal engine. Returns the root node, neighbor buckets (upward/downward/lateral), open violations, and a truncation report. Use this to understand a component's role in the architecture.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to fetch context for"),
    depth: z
      .number()
      .int()
      .min(1)
      .max(5)
      .optional()
      .describe("Traversal depth 1–5 (default 2)"),
    profile: z
      .enum(["OPERATIONAL", "ANALYTICAL", "FULL"])
      .optional()
      .describe(
        "Traversal profile controlling which edges and lifecycle states are visible. OPERATIONAL (default): EAGER edges, ACTIVE+DEPRECATED nodes. ANALYTICAL: adds LAZY edges, ARCHIVED nodes, and analytical buckets. FULL: all of the above plus inherited violations and history."
      ),
  },
  async ({ nodeId, depth, profile }) => {
    try {
      const data = await client.getContext(nodeId, depth, profile);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_search_nodes",
  "Search for nodes in the knowledge graph by type, layer, lifecycle status, text query, or JSONB attributes. Returns up to 20 matching nodes by default.",
  {
    query: z
      .string()
      .optional()
      .describe("Text search across node name and type"),
    type: z
      .string()
      .optional()
      .describe("Filter by node type, e.g. 'Service', 'BoundedContext'"),
    layer: z
      .enum(["L1", "L2", "L3", "L4", "L5", "L6"])
      .optional()
      .describe("Architecture layer"),
    lifecycleStatus: z
      .enum(["ACTIVE", "DEPRECATED", "ARCHIVED", "PURGE"])
      .optional()
      .describe("Lifecycle status filter"),
    attributes: z
      .record(z.unknown())
      .optional()
      .describe("JSONB attributes containment filter"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Max results (default 20)"),
  },
  async (params) => {
    try {
      const data = await client.searchNodes(params);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_batch_lookup",
  "Fetch multiple knowledge graph nodes by their IDs in a single request.",
  {
    ids: z
      .array(z.string().uuid())
      .min(1)
      .describe("List of node UUIDs to fetch"),
  },
  async ({ ids }) => {
    try {
      const data = await client.batchLookup(ids);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_get_stats",
  "Get aggregate statistics for the knowledge graph: node counts by lifecycle status, edge count, and open violation count.",
  {},
  async () => {
    try {
      const data = await client.getStats();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_violations_summary",
  "Get a summary of active (unresolved) violations grouped by severity: ERROR, WARN, INFO.",
  {},
  async () => {
    try {
      const data = await client.violationsSummary();
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_evaluate_node",
  "Run guardrail checks against a node and optionally persist detected violations. Returns the list of violations found.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to evaluate"),
    persist: z
      .boolean()
      .optional()
      .describe("Persist new violations to the database (default false)"),
  },
  async ({ nodeId, persist }) => {
    try {
      const data = await client.evaluateNode(nodeId, persist ?? false);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

// ── Traversal tools ──────────────────────────────────────────────────────────

server.tool(
  "lsds_traverse",
  "Traverse the knowledge graph starting from a node using recursive CTE traversal. Returns all reachable nodes up to the given depth with path metadata.",
  {
    nodeId: z.string().uuid().describe("Starting node UUID"),
    depth: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Traversal depth (default 3)"),
    direction: z
      .enum(["outbound", "inbound", "both"])
      .optional()
      .describe("Edge direction (default 'both')"),
    edgeTypes: z
      .array(z.string())
      .optional()
      .describe("Filter by edge types, e.g. ['DEPENDS_ON', 'IMPLEMENTS']"),
  },
  async ({ nodeId, depth, direction, edgeTypes }) => {
    try {
      const data = await client.traverse(nodeId, { depth, direction, edgeTypes });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

// ── Write Agent tools ────────────────────────────────────────────────────────

server.tool(
  "lsds_get_write_guidance",
  "Fetch the guardrails (with rationale and remediation) that apply to a given node type before creating or updating it. Call this BEFORE lsds_create_node so you can self-assess your draft against each rule. The framework runs final validation on write — your self-assessment is advisory.",
  {
    nodeType: z
      .string()
      .min(1)
      .describe("Node type the agent intends to write, e.g. 'Service', 'APIEndpoint', 'BoundedContext'"),
  },
  async ({ nodeType }) => {
    try {
      const data = await client.getWriteGuidance(nodeType);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_create_node",
  "Create a new node in the knowledge graph. Nodes represent architecture entities across six layers (L1=Business to L6=Operations).",
  {
    type: z
      .string()
      .min(1)
      .describe("Node type, e.g. 'Service', 'BoundedContext', 'APIEndpoint'"),
    layer: z
      .enum(["L1", "L2", "L3", "L4", "L5", "L6"])
      .describe("Architecture layer the node belongs to"),
    name: z.string().min(1).describe("Human-readable name for the node"),
    version: z.string().optional().describe("Semantic version (default '0.1.0')"),
    attributes: z
      .record(z.unknown())
      .optional()
      .describe("Arbitrary JSONB metadata"),
  },
  async ({ type, layer, name, version, attributes }) => {
    try {
      const data = await client.createNode({ type, layer, name, version, attributes });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_update_node",
  "Update an existing node's name, version, or attributes. Only provided fields are changed.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to update"),
    name: z.string().min(1).optional().describe("New name"),
    version: z.string().optional().describe("New semantic version"),
    attributes: z
      .record(z.unknown())
      .optional()
      .describe("Replacement JSONB attributes (full replace, not merge)"),
  },
  async ({ nodeId, name, version, attributes }) => {
    try {
      const data = await client.updateNode(nodeId, { name, version, attributes });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_delete_node",
  "Permanently delete a node and its associated edges. Prefer lsds_deprecate_node or lsds_archive_node for reversible removal.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to delete"),
  },
  async ({ nodeId }) => {
    try {
      const data = await client.deleteNode(nodeId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_create_edge",
  "Create a typed relationship (edge) between two nodes. The edge type must be valid for the source and target layers per the framework relationship rules.",
  {
    sourceId: z.string().uuid().describe("UUID of the source node"),
    targetId: z.string().uuid().describe("UUID of the target node"),
    type: z
      .string()
      .min(1)
      .describe(
        "Relationship type, e.g. 'DEPENDS_ON', 'IMPLEMENTS', 'EXPOSES'"
      ),
    layer: z
      .enum(["L1", "L2", "L3", "L4", "L5", "L6"])
      .describe("Layer the relationship belongs to"),
    traversalWeight: z
      .number()
      .positive()
      .optional()
      .describe("Weight for graph traversal algorithms (default 1.0)"),
    attributes: z
      .record(z.unknown())
      .optional()
      .describe("Arbitrary JSONB metadata"),
  },
  async ({ sourceId, targetId, type, layer, traversalWeight, attributes }) => {
    try {
      const data = await client.createEdge({
        sourceId,
        targetId,
        type,
        layer,
        traversalWeight,
        attributes,
      });
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

// ── Lifecycle tools ──────────────────────────────────────────────────────────

server.tool(
  "lsds_deprecate_node",
  "Mark a node as DEPRECATED — still visible and queryable but flagged as being phased out. Transitions: ACTIVE → DEPRECATED.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to deprecate"),
  },
  async ({ nodeId }) => {
    try {
      const data = await client.deprecateNode(nodeId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "lsds_archive_node",
  "Archive a node (ARCHIVED status) — read-only, excluded from active queries. The node must already be DEPRECATED. Transitions: DEPRECATED → ARCHIVED.",
  {
    nodeId: z.string().uuid().describe("UUID of the node to archive"),
  },
  async ({ nodeId }) => {
    try {
      const data = await client.archiveNode(nodeId);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "transition_node_lifecycle",
  "Drive a lifecycle state-machine transition for a node. Valid transitions: ACTIVE → DEPRECATED (deprecate), DEPRECATED → ARCHIVED (archive), ARCHIVED → PURGE (purge). On an invalid transition the tool returns a structured error with the current status, requested transition, and the list of allowed transitions.",
  {
    nodeId: z
      .string()
      .uuid()
      .describe("UUID of the node to transition"),
    transition: z
      .enum(["deprecate", "archive", "purge"])
      .describe("Lifecycle transition to apply"),
  },
  async ({ nodeId, transition }) => {
    try {
      const data = await client.transitionNodeLifecycle(nodeId, transition);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof LifecycleTransitionApiError) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "invalid lifecycle transition",
              currentStatus: e.currentStatus,
              requestedTransition: e.requestedTransition,
              allowed: e.allowed,
            }, null, 2),
          }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

server.tool(
  "transition_edge_lifecycle",
  "Drive a lifecycle state-machine transition for an edge. Valid transitions: ACTIVE → DEPRECATED (deprecate), DEPRECATED → ARCHIVED (archive), ARCHIVED → PURGE (purge). On an invalid transition the tool returns a structured error with the current status, requested transition, and the list of allowed transitions.",
  {
    edgeId: z
      .string()
      .uuid()
      .describe("UUID of the edge to transition"),
    transition: z
      .enum(["deprecate", "archive", "purge"])
      .describe("Lifecycle transition to apply"),
  },
  async ({ edgeId, transition }) => {
    try {
      const data = await client.transitionEdgeLifecycle(edgeId, transition);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      if (e instanceof LifecycleTransitionApiError) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: "invalid lifecycle transition",
              currentStatus: e.currentStatus,
              requestedTransition: e.requestedTransition,
              allowed: e.allowed,
            }, null, 2),
          }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: String(e) }], isError: true };
    }
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
