// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it, vi } from "vitest";
import type { Sql } from "../src/db/client.js";
import type { LsdsCache } from "../src/cache/index.js";
import { LifecycleService } from "../src/lifecycle/index.js";
import type { NodeRow } from "../src/db/types.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeNodeRow(overrides: Partial<NodeRow> = {}): NodeRow {
  return {
    id: "node-1",
    tenantId: "t1",
    type: "Service",
    layer: "L3",
    name: "auth-service",
    version: "1.0.0",
    lifecycleStatus: "ACTIVE",
    attributes: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    deprecatedAt: null,
    archivedAt: null,
    purgeAfter: null,
    ...overrides,
  };
}

function makeQueuedSql(responses: unknown[][]): Sql {
  const queue = [...responses];
  const fn = (_first: unknown, ..._rest: unknown[]) => Promise.resolve(queue.shift() ?? []);
  return fn as unknown as Sql;
}

function makeMockCache(): LsdsCache {
  return {
    nodes: {} as LsdsCache["nodes"],
    edges: {} as LsdsCache["edges"],
    traversals: {} as LsdsCache["traversals"],
    nodeKey: vi.fn(),
    edgeKey: vi.fn(),
    traversalKey: vi.fn(),
    invalidateNode: vi.fn(),
    invalidateEdge: vi.fn(),
    destroy: vi.fn(),
  } as unknown as LsdsCache;
}

// ── deprecate ─────────────────────────────────────────────────────────────────

describe("LifecycleService.deprecate", () => {
  it("returns the updated node row", async () => {
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED" });
    const svc = new LifecycleService(makeQueuedSql([[node]]), makeMockCache());
    const result = await svc.deprecate("t1", "node-1");
    expect(result.lifecycleStatus).toBe("DEPRECATED");
    expect(result.id).toBe("node-1");
  });

  it("invalidates the cache after deprecating", async () => {
    const node = makeNodeRow({ lifecycleStatus: "DEPRECATED" });
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[node]]), cache);
    await svc.deprecate("t1", "node-1");
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "node-1");
    expect(cache.invalidateNode).toHaveBeenCalledTimes(1);
  });

  it("throws when node is not found or not ACTIVE", async () => {
    const svc = new LifecycleService(makeQueuedSql([[]]), makeMockCache());
    await expect(svc.deprecate("t1", "missing")).rejects.toThrow("node not found or not ACTIVE");
  });

  it("does not call invalidateNode on failure", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[]]), cache);
    await svc.deprecate("t1", "missing").catch(() => undefined);
    expect(cache.invalidateNode).not.toHaveBeenCalled();
  });
});

// ── archive ───────────────────────────────────────────────────────────────────

describe("LifecycleService.archive", () => {
  it("returns the updated node row", async () => {
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED" });
    const svc = new LifecycleService(makeQueuedSql([[node]]), makeMockCache());
    const result = await svc.archive("t1", "node-1");
    expect(result.lifecycleStatus).toBe("ARCHIVED");
  });

  it("invalidates the cache after archiving", async () => {
    const node = makeNodeRow({ lifecycleStatus: "ARCHIVED" });
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[node]]), cache);
    await svc.archive("t1", "node-1");
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "node-1");
  });

  it("throws when node is not found or already archived/purged", async () => {
    const svc = new LifecycleService(makeQueuedSql([[]]), makeMockCache());
    await expect(svc.archive("t1", "node-1")).rejects.toThrow(
      "node not found or already archived/purged"
    );
  });

  it("does not call invalidateNode on failure", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[]]), cache);
    await svc.archive("t1", "node-1").catch(() => undefined);
    expect(cache.invalidateNode).not.toHaveBeenCalled();
  });
});

// ── markForPurge ──────────────────────────────────────────────────────────────

describe("LifecycleService.markForPurge", () => {
  it("returns the updated node row", async () => {
    const node = makeNodeRow({ lifecycleStatus: "PURGE" });
    const svc = new LifecycleService(makeQueuedSql([[node]]), makeMockCache());
    const result = await svc.markForPurge("t1", "node-1");
    expect(result.lifecycleStatus).toBe("PURGE");
  });

  it("invalidates the cache after marking for purge", async () => {
    const node = makeNodeRow({ lifecycleStatus: "PURGE" });
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[node]]), cache);
    await svc.markForPurge("t1", "node-1");
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "node-1");
  });

  it("throws when node is not ARCHIVED", async () => {
    const svc = new LifecycleService(makeQueuedSql([[]]), makeMockCache());
    await expect(svc.markForPurge("t1", "node-1")).rejects.toThrow(
      "node not found or not ARCHIVED"
    );
  });

  it("accepts a custom purgeAfterDays parameter", async () => {
    const node = makeNodeRow({ lifecycleStatus: "PURGE" });
    const svc = new LifecycleService(makeQueuedSql([[node]]), makeMockCache());
    await expect(svc.markForPurge("t1", "node-1", 30)).resolves.toBeDefined();
  });

  it("uses retention policy default when purgeAfterDays is not provided", async () => {
    const node = makeNodeRow({ lifecycleStatus: "PURGE" });
    const cache = makeMockCache();
    const svc = new LifecycleService(
      makeQueuedSql([[node]]),
      cache,
      { deprecatedToArchivedDays: 365, archivedToPurgeDays: 90 }
    );
    const result = await svc.markForPurge("t1", "node-1");
    expect(result).toBeDefined();
  });
});

// ── purge ─────────────────────────────────────────────────────────────────────

describe("LifecycleService.purge", () => {
  it("resolves without value when node is eligible", async () => {
    const svc = new LifecycleService(makeQueuedSql([[{ id: "node-1" }]]), makeMockCache());
    await expect(svc.purge("t1", "node-1")).resolves.toBeUndefined();
  });

  it("invalidates the cache after purge", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[{ id: "node-1" }]]), cache);
    await svc.purge("t1", "node-1");
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "node-1");
  });

  it("throws when node is not eligible for purge", async () => {
    const svc = new LifecycleService(makeQueuedSql([[]]), makeMockCache());
    await expect(svc.purge("t1", "node-1")).rejects.toThrow("node not eligible for purge");
  });

  it("does not call invalidateNode on failure", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[]]), cache);
    await svc.purge("t1", "node-1").catch(() => undefined);
    expect(cache.invalidateNode).not.toHaveBeenCalled();
  });
});

// ── applyRetentionPolicy ──────────────────────────────────────────────────────

describe("LifecycleService.applyRetentionPolicy", () => {
  it("returns counts of each transition batch", async () => {
    const svc = new LifecycleService(
      makeQueuedSql([
        [{ id: "n1" }, { id: "n2" }], // deprecated → archived
        [{ id: "n3" }],               // archived → purge
      ]),
      makeMockCache()
    );
    const result = await svc.applyRetentionPolicy("t1");
    expect(result.deprecated).toBe(2);
    expect(result.archived).toBe(1);
  });

  it("returns zeros when no nodes transition", async () => {
    const svc = new LifecycleService(makeQueuedSql([[], []]), makeMockCache());
    const result = await svc.applyRetentionPolicy("t1");
    expect(result).toEqual({ deprecated: 0, archived: 0 });
  });

  it("invalidates cache for all transitioned nodes", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(
      makeQueuedSql([[{ id: "n1" }], [{ id: "n2" }]]),
      cache
    );
    await svc.applyRetentionPolicy("t1");
    expect(cache.invalidateNode).toHaveBeenCalledTimes(2);
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "n1");
    expect(cache.invalidateNode).toHaveBeenCalledWith("t1", "n2");
  });

  it("does not call invalidateNode when both batches are empty", async () => {
    const cache = makeMockCache();
    const svc = new LifecycleService(makeQueuedSql([[], []]), cache);
    await svc.applyRetentionPolicy("t1");
    expect(cache.invalidateNode).not.toHaveBeenCalled();
  });

  it("uses custom retention policy thresholds", async () => {
    const svc = new LifecycleService(
      makeQueuedSql([[], []]),
      makeMockCache(),
      { deprecatedToArchivedDays: 30, archivedToPurgeDays: 60 }
    );
    const result = await svc.applyRetentionPolicy("t1");
    expect(result).toEqual({ deprecated: 0, archived: 0 });
  });
});
