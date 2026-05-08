// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runExport } from "../src/commands/export.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("runExport", () => {
  let outDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "lsds-export-test-"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(outDir, { recursive: true, force: true });
  });

  it("writes a JSON file with nodes and edges", async () => {
    const nodes = [{ id: "n1", type: "Service", layer: "L4", name: "svc-a" }];
    const edges = [{ id: "e1", sourceId: "n1", targetId: "n2", type: "depends_on" }];

    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({ data: nodes, total: 1 }))  // nodes page 1
      .mockResolvedValueOnce(jsonResponse({ data: edges, total: 1 })); // edges page 1

    const outFile = join(outDir, "export.json");
    const result = await runExport({
      format: "json",
      out: outFile,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.nodeCount).toBe(1);
    expect(result.edgeCount).toBe(1);
    expect(result.outPath).toBe(outFile);

    const parsed = JSON.parse(readFileSync(outFile, "utf8"));
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.edges).toHaveLength(1);
    expect(parsed.exportedAt).toBeDefined();
  });

  it("paginates when total > one page", async () => {
    const page1 = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}` }));
    const page2 = [{ id: "n500" }];

    vi.mocked(fetch)
      // nodes: two pages
      .mockResolvedValueOnce(jsonResponse({ data: page1, total: 501 }))
      .mockResolvedValueOnce(jsonResponse({ data: page2, total: 501 }))
      // edges: one empty page
      .mockResolvedValueOnce(jsonResponse({ data: [], total: 0 }));

    const outFile = join(outDir, "paginated.json");
    const result = await runExport({
      format: "json",
      out: outFile,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.nodeCount).toBe(501);
    expect(result.edgeCount).toBe(0);
  });

  it("passes Authorization header on every request", async () => {
    const mockFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: [], total: 0 }))
      .mockResolvedValueOnce(jsonResponse({ data: [], total: 0 }));
    vi.stubGlobal("fetch", mockFetch);

    await runExport({
      format: "json",
      out: join(outDir, "out.json"),
      apiUrl: "http://api.example.com",
      apiKey: "my-key",
    });

    for (const call of mockFetch.mock.calls) {
      const [, init] = call as [string, RequestInit];
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-key");
    }
  });

  it("throws on API error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 })
    );

    await expect(
      runExport({
        format: "json",
        out: join(outDir, "err.json"),
        apiUrl: "http://localhost:3000",
        apiKey: "bad-key",
      })
    ).rejects.toThrow(/API error 401/);
  });
});
