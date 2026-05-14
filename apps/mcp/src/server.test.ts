// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

/**
 * In-process tests for the lsds_submit_feedback MCP tool handler.
 *
 * These tests mirror the tool registration from index.ts to exercise the two
 * code paths in the handler: success (formatted JSON text) and error (isError: true).
 * The underlying API contract is tested in apps/api/tests/feedback.test.ts.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";

type FeedbackResponse = {
  id: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

type MockSubmitFeedback = (args: {
  content: string;
  category?: string;
  severity?: string;
  refNodeId?: string;
}) => Promise<FeedbackResponse>;

async function buildPair(submitFeedback: MockSubmitFeedback): Promise<{
  mcpClient: Client;
  cleanup: () => Promise<void>;
}> {
  const mcpServer = new McpServer({ name: "lsds", version: "0.1.0" });

  mcpServer.tool(
    "lsds_submit_feedback",
    "Submit feedback",
    {
      content: z.string().min(1).describe("Feedback text"),
      category: z
        .enum(["graph_quality", "agent_response", "missing_data", "incorrect_data", "other"])
        .optional(),
      severity: z.enum(["low", "medium", "high"]).optional(),
      refNodeId: z.string().uuid().optional(),
    },
    async ({ content, category, severity, refNodeId }) => {
      try {
        const data = await submitFeedback({ content, category, severity, refNodeId });
        return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
      } catch (e) {
        return { content: [{ type: "text" as const, text: String(e) }], isError: true };
      }
    }
  );

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcpClient = new Client({ name: "test-client", version: "0.0.0" });

  await Promise.all([
    mcpServer.connect(serverTransport),
    mcpClient.connect(clientTransport),
  ]);

  return {
    mcpClient,
    cleanup: () => mcpClient.close(),
  };
}

describe("lsds_submit_feedback MCP tool handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns formatted JSON text content on success", async () => {
    const stored: FeedbackResponse = {
      id: "00000000-0000-0000-0000-000000000001",
      type: "general",
      message: "stale node data",
      metadata: null,
      createdAt: "2026-05-14T00:00:00.000Z",
    };
    const submitFeedback = vi.fn<MockSubmitFeedback>().mockResolvedValue(stored);

    const { mcpClient, cleanup } = await buildPair(submitFeedback);
    try {
      const result = await mcpClient.callTool({
        name: "lsds_submit_feedback",
        arguments: { content: "stale node data" },
      });

      expect(result.isError).toBeFalsy();
      expect(result.content).toHaveLength(1);
      const item = result.content[0] as { type: string; text: string };
      expect(item.type).toBe("text");
      expect(JSON.parse(item.text)).toEqual(stored);
      expect(submitFeedback).toHaveBeenCalledWith({
        content: "stale node data",
        category: undefined,
        severity: undefined,
        refNodeId: undefined,
      });
    } finally {
      await cleanup();
    }
  });

  it("returns isError=true and error message text when client throws", async () => {
    const submitFeedback = vi
      .fn<MockSubmitFeedback>()
      .mockRejectedValue(new Error("500 internal server error"));

    const { mcpClient, cleanup } = await buildPair(submitFeedback);
    try {
      const result = await mcpClient.callTool({
        name: "lsds_submit_feedback",
        arguments: { content: "will fail" },
      });

      expect(result.isError).toBe(true);
      const item = result.content[0] as { type: string; text: string };
      expect(item.type).toBe("text");
      expect(item.text).toContain("500 internal server error");
    } finally {
      await cleanup();
    }
  });
});
