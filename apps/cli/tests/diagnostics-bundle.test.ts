// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createGunzip } from "node:zlib";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { PassThrough } from "node:stream";
import { runDiagnosticsBundle } from "../src/commands/diagnostics-bundle.js";

async function readGzipBytes(path: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const pass = new PassThrough();
  pass.on("data", (c: Buffer) => chunks.push(c));
  await pipeline(createReadStream(path), createGunzip(), pass);
  return Buffer.concat(chunks);
}

describe("diagnostics bundle", () => {
  let outDir: string;
  let logDir: string;

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), "lsds-diag-out-"));
    logDir = mkdtempSync(join(tmpdir(), "lsds-diag-logs-"));
  });

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true });
    rmSync(logDir, { recursive: true, force: true });
  });

  it("creates a .tar.gz file in the output directory", async () => {
    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: undefined,
    });
    expect(bundlePath).toMatch(/\.tar\.gz$/);
    expect(existsSync(bundlePath)).toBe(true);
  });

  it("bundle contains no secret values from process.env", async () => {
    const SECRET = "my-super-secret-value-9f3k2p";

    const origEnv = process.env;
    process.env = { ...origEnv, API_KEY: SECRET, JWT_TOKEN: SECRET };

    try {
      const bundlePath = await runDiagnosticsBundle({
        outDir,
        days: 7,
        logDir,
        databaseUrl: undefined,
      });

      const raw = await readGzipBytes(bundlePath);
      expect(raw.includes(Buffer.from(SECRET))).toBe(false);
    } finally {
      process.env = origEnv;
    }
  });

  it("includes log files modified within the days window", async () => {
    writeFileSync(join(logDir, "app-today.log"), "line 1\nline 2\n");

    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: undefined,
    });

    const raw = await readGzipBytes(bundlePath);
    expect(raw.includes(Buffer.from("app-today.log"))).toBe(true);
  });

  it("includes system-info.json with node version", async () => {
    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: undefined,
    });

    const raw = await readGzipBytes(bundlePath);
    expect(raw.includes(Buffer.from("nodeVersion"))).toBe(true);
    expect(raw.includes(Buffer.from(process.version))).toBe(true);
  });

  it("includes db-skipped.txt when DATABASE_URL is not set", async () => {
    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: undefined,
    });

    const raw = await readGzipBytes(bundlePath);
    expect(raw.includes(Buffer.from("db-skipped.txt"))).toBe(true);
    expect(raw.includes(Buffer.from("DATABASE_URL not set"))).toBe(true);
    // Skip note must call out topology so support reviewers know the gap.
    expect(raw.includes(Buffer.from("topology"))).toBe(true);
  });

  it("omits topology.json when DATABASE_URL is unset", async () => {
    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: undefined,
    });

    const raw = await readGzipBytes(bundlePath);
    expect(raw.includes(Buffer.from("topology.json"))).toBe(false);
  });

  it("writes db-error.txt and omits topology.json on bad DATABASE_URL", async () => {
    // 127.0.0.1:1 always refuses TCP — connect fails fast.
    const bundlePath = await runDiagnosticsBundle({
      outDir,
      days: 7,
      logDir,
      databaseUrl: "postgres://lsds:lsds@127.0.0.1:1/lsds",
    });

    const raw = await readGzipBytes(bundlePath);
    expect(raw.includes(Buffer.from("db-error.txt"))).toBe(true);
    expect(raw.includes(Buffer.from("topology.json"))).toBe(false);
    expect(raw.includes(Buffer.from("schema-snapshot.json"))).toBe(false);
  }, 15_000);
});
