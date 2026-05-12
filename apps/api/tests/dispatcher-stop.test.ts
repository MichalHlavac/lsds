// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, vi } from "vitest";
import { createWebhookDispatcher } from "../src/webhooks/dispatcher";

describe("WebhookDispatcher.stop()", () => {
  it("resolves immediately when no poll is in-flight", async () => {
    const mockSql = { begin: vi.fn() } as any;
    const dispatcher = createWebhookDispatcher(mockSql);

    const t0 = performance.now();
    await dispatcher.stop();
    expect(performance.now() - t0).toBeLessThan(50);
    expect(mockSql.begin).not.toHaveBeenCalled();
  });

  it("waits for an in-flight poll to settle before resolving", async () => {
    let resolveBlocker!: (rows: unknown[]) => void;
    const blocker = new Promise<unknown[]>((resolve) => { resolveBlocker = resolve; });

    const mockSql = { begin: vi.fn().mockReturnValue(blocker) } as any;
    const dispatcher = createWebhookDispatcher(mockSql);

    const pollPromise = dispatcher.poll();

    let stopSettled = false;
    const stopPromise = dispatcher.stop(2000).then(() => { stopSettled = true; });

    // Yield to microtasks — stop should still be pending while poll is blocked
    await new Promise((r) => setTimeout(r, 20));
    expect(stopSettled).toBe(false);

    // Unblock the poll → stop should now resolve
    resolveBlocker([]);
    await pollPromise;
    await stopPromise;
    expect(stopSettled).toBe(true);
  });

  it("stops after timeout when in-flight poll never settles", async () => {
    const mockSql = {
      begin: vi.fn().mockReturnValue(new Promise(() => {})), // hangs forever
    } as any;
    const dispatcher = createWebhookDispatcher(mockSql);

    void dispatcher.poll(); // kick off inflight, do not await

    const t0 = performance.now();
    await dispatcher.stop(50); // 50 ms timeout
    const elapsed = performance.now() - t0;

    // Should have bailed out at the 50 ms timeout
    expect(elapsed).toBeGreaterThanOrEqual(45);
    expect(elapsed).toBeLessThan(500);
  });
});
