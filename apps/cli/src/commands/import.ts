// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { readFile, readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export interface ImportOptions {
  format: "markdown";
  dir: string;
  apiUrl: string;
  apiKey: string;
}

export interface ImportResult {
  created: number;
  skipped: number;
  failed: number;
}

// Lightweight YAML frontmatter parser — supports string, number, boolean scalars.
function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { data: {}, body: content.trim() };

  const [, yaml = "", rest = ""] = match;
  const data: Record<string, unknown> = {};

  for (const line of yaml.split(/\r?\n/)) {
    const kv = /^([^:#\s][^:]*?):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const [, key, rawVal = ""] = kv;
    const trimmedKey = (key ?? "").trim();
    const val = rawVal.trim();
    if (!trimmedKey) continue;
    if (val === "true") data[trimmedKey] = true;
    else if (val === "false") data[trimmedKey] = false;
    else if (val !== "" && /^-?\d+(\.\d+)?$/.test(val)) data[trimmedKey] = Number(val);
    else data[trimmedKey] = val;
  }

  return { data, body: rest.trim() };
}

const VALID_LAYERS = new Set(["L1", "L2", "L3", "L4", "L5", "L6"]);
const BATCH_SIZE = 500;

interface NodePayload {
  type: string;
  layer: string;
  name: string;
  version?: string;
  lifecycleStatus?: string;
  attributes: Record<string, unknown>;
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(fullPath)));
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      files.push(fullPath);
    }
  }
  return files;
}

async function postBulk(
  apiUrl: string,
  apiKey: string,
  nodes: NodePayload[]
): Promise<{ created: number; failed: number }> {
  const res = await fetch(`${apiUrl}/v1/import/bulk`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify({ nodes, edges: [] }),
  });

  if (res.status === 409) return { created: 0, failed: nodes.length };
  if (!res.ok) return { created: 0, failed: nodes.length };

  const body = (await res.json()) as {
    data: { created: { nodes: string[]; edges: string[] } };
  };
  return { created: body.data.created.nodes.length, failed: 0 };
}

// On a 409 from a batch, retry each node individually to distinguish
// duplicates (skipped) from genuine errors (failed).
async function retryIndividually(
  apiUrl: string,
  apiKey: string,
  nodes: NodePayload[]
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const node of nodes) {
    const res = await fetch(`${apiUrl}/v1/import/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": apiKey,
      },
      body: JSON.stringify({ nodes: [node], edges: [] }),
    });

    if (res.status === 409) {
      skipped++;
    } else if (!res.ok) {
      failed++;
    } else {
      created++;
    }
  }

  return { created, skipped, failed };
}

export async function runImport(opts: ImportOptions): Promise<ImportResult> {
  const mdFiles = await findMarkdownFiles(opts.dir);
  const result: ImportResult = { created: 0, skipped: 0, failed: 0 };

  const nodes: NodePayload[] = [];
  const skippedFiles: string[] = [];

  for (const filePath of mdFiles) {
    const content = await readFile(filePath, "utf8");
    const { data, body } = parseFrontmatter(content);

    const type = data["type"];
    const layer = data["layer"];

    if (typeof type !== "string" || !type) {
      skippedFiles.push(`${filePath}: missing 'type' in frontmatter`);
      result.skipped++;
      continue;
    }
    if (typeof layer !== "string" || !VALID_LAYERS.has(layer)) {
      skippedFiles.push(
        `${filePath}: missing or invalid 'layer' (must be L1–L6)`
      );
      result.skipped++;
      continue;
    }

    const name =
      typeof data["name"] === "string" && data["name"]
        ? data["name"]
        : basename(filePath, extname(filePath));

    const { type: _t, layer: _l, name: _n, version, lifecycleStatus, ...rest } = data;

    nodes.push({
      type,
      layer,
      name,
      ...(typeof version === "string" && version ? { version } : {}),
      ...(typeof lifecycleStatus === "string" && lifecycleStatus
        ? { lifecycleStatus }
        : {}),
      attributes: { ...rest, ...(body ? { body } : {}) },
    });
  }

  for (let i = 0; i < nodes.length; i += BATCH_SIZE) {
    const batch = nodes.slice(i, i + BATCH_SIZE);
    const done = Math.min(i + batch.length, nodes.length);
    process.stderr.write(`\rImporting... ${done}/${nodes.length}`);

    const res = await fetch(`${opts.apiUrl}/v1/import/bulk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": opts.apiKey,
      },
      body: JSON.stringify({ nodes: batch, edges: [] }),
    });

    if (res.status === 409) {
      // Retry individually to distinguish duplicates from failures.
      const r = await retryIndividually(opts.apiUrl, opts.apiKey, batch);
      result.created += r.created;
      result.skipped += r.skipped;
      result.failed += r.failed;
    } else if (!res.ok) {
      result.failed += batch.length;
    } else {
      const body = (await res.json()) as {
        data: { created: { nodes: string[]; edges: string[] } };
      };
      result.created += body.data.created.nodes.length;
    }
  }

  if (nodes.length > 0) process.stderr.write("\n");

  for (const msg of skippedFiles) {
    console.error(`  skipped: ${msg}`);
  }

  return result;
}
