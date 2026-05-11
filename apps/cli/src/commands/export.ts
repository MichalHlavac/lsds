// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { writeFile } from "node:fs/promises";

export interface ExportOptions {
  format: "json";
  out: string;
  apiUrl: string;
  apiKey: string;
}

export interface ExportResult {
  nodeCount: number;
  edgeCount: number;
  outPath: string;
}

async function fetchAllPages<T>(apiUrl: string, apiKey: string, path: string): Promise<T[]> {
  const items: T[] = [];
  const limit = 500;
  let cursor: string | undefined;

  while (true) {
    const qs = new URLSearchParams({ limit: String(limit), includeArchived: "true" });
    if (cursor) qs.set("cursor", cursor);
    const url = `${apiUrl}${path}?${qs}`;
    const res = await fetch(url, {
      headers: { "X-Api-Key": apiKey },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API error ${res.status} fetching ${path}: ${text}`);
    }
    const body = (await res.json()) as { data: T[]; nextCursor: string | null };
    items.push(...body.data);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }

  return items;
}

export async function runExport(opts: ExportOptions): Promise<ExportResult> {
  const nodes = await fetchAllPages<Record<string, unknown>>(opts.apiUrl, opts.apiKey, "/v1/nodes");
  const edges = await fetchAllPages<Record<string, unknown>>(opts.apiUrl, opts.apiKey, "/v1/edges");

  const payload = {
    exportedAt: new Date().toISOString(),
    nodes,
    edges,
  };

  await writeFile(opts.out, JSON.stringify(payload, null, 2), "utf8");

  return { nodeCount: nodes.length, edgeCount: edges.length, outPath: opts.out };
}
