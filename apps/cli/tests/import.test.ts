// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runImport } from "../src/commands/import.js";

function jsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bulkOk(nodeCount: number): Response {
  const ids = Array.from({ length: nodeCount }, (_, i) => `id-${i}`);
  return jsonResponse({ data: { created: { nodes: ids, edges: [] }, errors: [] } }, 201);
}

describe("runImport", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lsds-import-test-"));
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    rmSync(dir, { recursive: true, force: true });
  });

  it("imports markdown files with valid frontmatter", async () => {
    writeFileSync(
      join(dir, "svc-alpha.md"),
      `---\ntype: Service\nlayer: L4\nname: svc-alpha\n---\n\nService description.`
    );
    writeFileSync(
      join(dir, "svc-beta.md"),
      `---\ntype: Service\nlayer: L4\nname: svc-beta\n---`
    );

    vi.mocked(fetch).mockResolvedValueOnce(bulkOk(2));

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("uses filename as name when frontmatter has no name field", async () => {
    writeFileSync(
      join(dir, "my-service.md"),
      `---\ntype: Service\nlayer: L4\n---`
    );

    vi.mocked(fetch).mockResolvedValueOnce(bulkOk(1));

    await runImport({ format: "markdown", dir, apiUrl: "http://localhost:3000", apiKey: "k" });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.nodes[0].name).toBe("my-service");
  });

  it("skips files missing required 'type' frontmatter", async () => {
    writeFileSync(join(dir, "no-type.md"), `---\nlayer: L4\n---`);
    writeFileSync(join(dir, "valid.md"), `---\ntype: Service\nlayer: L4\n---`);

    vi.mocked(fetch).mockResolvedValueOnce(bulkOk(1));

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(1);
  });

  it("skips files with invalid 'layer' frontmatter", async () => {
    writeFileSync(join(dir, "bad-layer.md"), `---\ntype: Service\nlayer: L99\n---`);

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it("handles 409 (duplicate) by retrying individually and counting as skipped", async () => {
    writeFileSync(join(dir, "dup.md"), `---\ntype: Service\nlayer: L4\nname: dup-svc\n---`);

    // batch 409 → individual 409
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response("{}", { status: 409 }))   // batch fails
      .mockResolvedValueOnce(new Response("{}", { status: 409 }));  // individual retry → skipped

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
    expect(result.failed).toBe(0);
  });

  it("counts non-409 API errors as failed", async () => {
    writeFileSync(join(dir, "node.md"), `---\ntype: Service\nlayer: L4\n---`);

    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Internal Server Error", { status: 500 })
    );

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.failed).toBe(1);
    expect(result.created).toBe(0);
  });

  it("recurses into subdirectories", async () => {
    const sub = join(dir, "subdir");
    mkdirSync(sub);
    writeFileSync(join(sub, "nested.md"), `---\ntype: Service\nlayer: L4\n---`);

    vi.mocked(fetch).mockResolvedValueOnce(bulkOk(1));

    const result = await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "k",
    });

    expect(result.created).toBe(1);
  });

  it("sends Authorization header and never logs the API key", async () => {
    writeFileSync(join(dir, "node.md"), `---\ntype: Service\nlayer: L4\n---`);

    const mockFetch = vi.fn().mockResolvedValueOnce(bulkOk(1));
    vi.stubGlobal("fetch", mockFetch);
    const consoleSpy = vi.spyOn(console, "log");

    await runImport({
      format: "markdown",
      dir,
      apiUrl: "http://localhost:3000",
      apiKey: "top-secret",
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer top-secret");

    for (const call of consoleSpy.mock.calls) {
      expect(String(call[0])).not.toContain("top-secret");
    }
  });

  it("places extra frontmatter keys in attributes", async () => {
    writeFileSync(
      join(dir, "rich.md"),
      `---\ntype: Service\nlayer: L4\nowner: team-alpha\ncriticality: high\n---`
    );

    vi.mocked(fetch).mockResolvedValueOnce(bulkOk(1));

    await runImport({ format: "markdown", dir, apiUrl: "http://localhost:3000", apiKey: "k" });

    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    const attrs = body.nodes[0].attributes as Record<string, unknown>;
    expect(attrs["owner"]).toBe("team-alpha");
    expect(attrs["criticality"]).toBe("high");
  });
});
