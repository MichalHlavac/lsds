#!/usr/bin/env node
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { parseArgs } from "node:util";
import { runDiagnosticsBundle } from "./commands/diagnostics-bundle.js";

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    out: { type: "string", short: "o", default: "." },
    days: { type: "string", short: "d", default: "7" },
    "log-dir": { type: "string", default: "/var/log/lsds" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const [command, subcommand] = positionals;

if (values.help || !command) {
  console.log(`
lsds — LSDS operational CLI

Commands:
  diagnostics bundle   Collect a redacted diagnostics bundle for support

Options:
  -o, --out <dir>      Output directory (default: .)
  -d, --days <n>       Include logs from the last N days (default: 7)
      --log-dir <dir>  Directory containing app *.log files (default: /var/log/lsds)
  -h, --help           Show this help
`.trim());
  process.exit(0);
}

if (command === "diagnostics" && subcommand === "bundle") {
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
