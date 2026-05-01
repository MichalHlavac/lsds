#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { fileURLToPath, URL } from "node:url";
import { runDiagnosticsBundle } from "./commands/diagnostics-bundle.js";
import { runBackup } from "./commands/backup.js";
import { runRestore } from "./commands/restore.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o", default: "." },
    days: { type: "string", short: "d", default: "7" },
    "log-dir": { type: "string", default: "/var/log/lsds" },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "V", default: false },
  },
});

const [command, subcommand] = positionals;

if (values.version) {
  const pkgPath = new URL("../package.json", import.meta.url);
  const { version } = JSON.parse(readFileSync(fileURLToPath(pkgPath), "utf8")) as { version: string };
  console.log(`lsds/${version}`);
  process.exit(0);
}

if (values.help || !command) {
  console.log(`
lsds — LSDS operational CLI

Commands:
  backup <out-dir>         Backup full LSDS state to a tar bundle
  restore <bundle>         Restore LSDS state from a tar bundle
  diagnostics bundle       Collect a redacted diagnostics bundle for support

Options:
  -o, --out <dir>      Output directory for backup (default: .)
  -d, --days <n>       Include logs from the last N days (default: 7)
      --log-dir <dir>  Directory containing app *.log files (default: /var/log/lsds)
  -h, --help           Show this help
`.trim());
  process.exit(0);
}

if (command === "backup") {
  const outDir = subcommand ?? String(values.out);
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is required for backup.");
    process.exit(1);
  }
  const bundlePath = await runBackup({ outDir, databaseUrl });
  console.log(`Backup written to: ${bundlePath}`);
} else if (command === "restore") {
  const bundlePath = subcommand;
  if (!bundlePath) {
    console.error("Error: restore requires a bundle path argument.\nUsage: lsds restore <bundle>");
    process.exit(1);
  }
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("Error: DATABASE_URL environment variable is required for restore.");
    process.exit(1);
  }
  await runRestore({ bundlePath, databaseUrl });
} else if (command === "diagnostics" && subcommand === "bundle") {
  const bundlePath = await runDiagnosticsBundle({
    outDir: String(values.out),
    days: Math.max(1, parseInt(String(values.days), 10) || 7),
    logDir: String(values["log-dir"]),
    databaseUrl: process.env["DATABASE_URL"],
  });
  console.log(`Bundle written to: ${bundlePath}`);
} else {
  console.error(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`);
  console.error("Run `lsds --help` for usage.");
  process.exit(1);
}
