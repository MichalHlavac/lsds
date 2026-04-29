// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import type { NodeRow, EdgeRow } from "../db/types.js";

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly ttlMs: number = 5 * 60 * 1000) {
    this.sweepTimer = setInterval(() => this.sweep(), this.ttlMs);
    if (this.sweepTimer.unref) this.sweepTimer.unref();
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttlMs ?? this.ttlMs),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  invalidatePattern(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.store.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }
}

export class LsdsCache {
  readonly nodes: TtlCache<NodeRow>;
  readonly edges: TtlCache<EdgeRow>;
  readonly traversals: TtlCache<unknown>;

  constructor(ttlMs: number = 5 * 60 * 1000) {
    this.nodes = new TtlCache(ttlMs);
    this.edges = new TtlCache(ttlMs);
    this.traversals = new TtlCache(ttlMs);
  }

  nodeKey(tenantId: string, nodeId: string): string {
    return `${tenantId}:${nodeId}`;
  }

  edgeKey(tenantId: string, edgeId: string): string {
    return `${tenantId}:${edgeId}`;
  }

  traversalKey(
    tenantId: string,
    rootId: string,
    depth: number,
    direction: string,
    edgeTypes?: string[]
  ): string {
    const et = edgeTypes?.sort().join(",") ?? "";
    return `${tenantId}:${rootId}:${depth}:${direction}:${et}`;
  }

  invalidateNode(tenantId: string, nodeId: string): void {
    this.nodes.delete(this.nodeKey(tenantId, nodeId));
    this.traversals.invalidatePattern(`${tenantId}:`);
  }

  invalidateEdge(tenantId: string, edgeId: string, sourceId: string, targetId: string): void {
    this.edges.delete(this.edgeKey(tenantId, edgeId));
    this.traversals.invalidatePattern(`${tenantId}:${sourceId}:`);
    this.traversals.invalidatePattern(`${tenantId}:${targetId}:`);
  }

  destroy(): void {
    this.nodes.destroy();
    this.edges.destroy();
    this.traversals.destroy();
  }
}

export const cache = new LsdsCache(
  Number(process.env.CACHE_TTL_MS ?? 5 * 60 * 1000)
);
