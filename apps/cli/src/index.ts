#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { Command } from "commander";
import { runBackup } from "./commands/backup.js";
import { runRestore } from "./commands/restore.js";
import { runDiagnosticsBundle } from "./commands/diagnostics-bundle.js";
import { runImport } from "./commands/import.js";
import { runExport } from "./commands/export.js";
import { runVerify } from "./commands/verify.js";

const pkgPath = new URL("../package.json", import.meta.url);
const { version } = JSON.parse(readFileSync(fileURLToPath(pkgPath), "utf8")) as {
  version: string;
};

const program = new Command();
program.name("lsds").description("LSDS CLI").version(version, "-V, --version");

// ── backup ────────────────────────────────────────────────────────────────────

program
  .command("backup <out-dir>")
  .description("Backup full LSDS state to a tar bundle")
  .action(async (outDir: string) => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      console.error("Error: DATABASE_URL environment variable is required.");
      process.exit(1);
    }
    const bundlePath = await runBackup({ outDir, databaseUrl });
    console.log(`Backup written to: ${bundlePath}`);
  });

// ── restore ───────────────────────────────────────────────────────────────────

program
  .command("restore <bundle>")
  .description("Restore LSDS state from a tar bundle")
  .action(async (bundlePath: string) => {
    const databaseUrl = process.env["DATABASE_URL"];
    if (!databaseUrl) {
      console.error("Error: DATABASE_URL environment variable is required.");
      process.exit(1);
    }
    await runRestore({ bundlePath, databaseUrl });
  });

// ── diagnostics ───────────────────────────────────────────────────────────────

const diagnostics = program
  .command("diagnostics")
  .description("Diagnostics commands");

diagnostics
  .command("bundle")
  .description("Collect a redacted diagnostics bundle for support")
  .option("-o, --out <dir>", "Output directory", ".")
  .option("-d, --days <n>", "Include logs from the last N days", "7")
  .option("--log-dir <dir>", "Log directory", "/var/log/lsds")
  .action(
    async (opts: { out: string; days: string; logDir: string }) => {
      const bundlePath = await runDiagnosticsBundle({
        outDir: opts.out,
        days: Math.max(1, parseInt(opts.days, 10) || 7),
        logDir: opts.logDir,
        databaseUrl: process.env["DATABASE_URL"],
      });
      console.log(`Bundle written to: ${bundlePath}`);
    }
  );

// ── import ────────────────────────────────────────────────────────────────────

program
  .command("import")
  .description("Import nodes from files into the LSDS knowledge graph")
  .requiredOption("--format <format>", "Input format (markdown)")
  .requiredOption("--dir <dir>", "Source directory containing files to import")
  .option("--api-url <url>", "API base URL (or LSDS_API_URL env)")
  .option("--api-key <key>", "API key (or LSDS_API_KEY env)")
  .action(async (opts: { format: string; dir: string; apiUrl?: string; apiKey?: string }) => {
    const apiUrl = opts.apiUrl ?? process.env["LSDS_API_URL"];
    const apiKey = opts.apiKey ?? process.env["LSDS_API_KEY"];

    if (!apiUrl) {
      console.error("Error: --api-url or LSDS_API_URL is required.");
      process.exit(1);
    }
    if (!apiKey) {
      console.error("Error: --api-key or LSDS_API_KEY is required.");
      process.exit(1);
    }
    if (opts.format !== "markdown") {
      console.error(`Error: unsupported format '${opts.format}'. Supported: markdown`);
      process.exit(1);
    }

    const result = await runImport({ format: "markdown", dir: opts.dir, apiUrl, apiKey });
    console.log(
      `Import complete: ${result.created} created, ${result.skipped} skipped, ${result.failed} failed`
    );
  });

// ── export ────────────────────────────────────────────────────────────────────

program
  .command("export")
  .description("Export all nodes and edges to a JSON file")
  .requiredOption("--format <format>", "Output format (json)")
  .requiredOption("--out <file>", "Output file path")
  .option("--api-url <url>", "API base URL (or LSDS_API_URL env)")
  .option("--api-key <key>", "API key (or LSDS_API_KEY env)")
  .action(async (opts: { format: string; out: string; apiUrl?: string; apiKey?: string }) => {
    const apiUrl = opts.apiUrl ?? process.env["LSDS_API_URL"];
    const apiKey = opts.apiKey ?? process.env["LSDS_API_KEY"];

    if (!apiUrl) {
      console.error("Error: --api-url or LSDS_API_URL is required.");
      process.exit(1);
    }
    if (!apiKey) {
      console.error("Error: --api-key or LSDS_API_KEY is required.");
      process.exit(1);
    }
    if (opts.format !== "json") {
      console.error(`Error: unsupported format '${opts.format}'. Supported: json`);
      process.exit(1);
    }

    const result = await runExport({ format: "json", out: opts.out, apiUrl, apiKey });
    console.log(
      `Exported ${result.nodeCount} nodes and ${result.edgeCount} edges to ${result.outPath}`
    );
  });

// ── verify ────────────────────────────────────────────────────────────────────

program
  .command("verify")
  .description("Check if the LSDS API is healthy and ready (exits 0 = ready, 1 = not ready)")
  .option("--api-url <url>", "API base URL (or LSDS_API_URL env)")
  .option("--api-key <key>", "API key (or LSDS_API_KEY env)")
  .action(async (opts: { apiUrl?: string; apiKey?: string }) => {
    const apiUrl = opts.apiUrl ?? process.env["LSDS_API_URL"];
    const apiKey = opts.apiKey ?? process.env["LSDS_API_KEY"] ?? "";

    if (!apiUrl) {
      console.error("Error: --api-url or LSDS_API_URL is required.");
      process.exit(1);
    }

    const result = await runVerify({ apiUrl, apiKey });
    if (result.ready) {
      console.log("ready");
      process.exit(0);
    } else {
      console.error(`not ready: HTTP ${result.status}`);
      process.exit(1);
    }
  });

// ── parse ─────────────────────────────────────────────────────────────────────

await program.parseAsync(process.argv);
