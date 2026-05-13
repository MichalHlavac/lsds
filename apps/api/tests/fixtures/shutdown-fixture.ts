// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Spawnable server harness for graceful-shutdown integration tests.
// Env controls:
//   PORT                — required; port to listen on
//   SHUTDOWN_TIMEOUT_MS — hard-kill timeout in ms (default: 10000)
//   FORCE_HANG_SQL_END  — if "true", sql.end() never resolves (simulates hung cleanup)
//
// Signals readiness by writing "READY:<port>\n" to stdout.

import { serve } from "@hono/node-server";
import { app } from "../../src/app.js";
import { sql } from "../../src/db/client.js";

const SHUTDOWN_TIMEOUT_MS = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);
const FORCE_HANG_SQL_END = process.env.FORCE_HANG_SQL_END === "true";
const port = Number(process.env.PORT);

let shutdownOnce = false;

const server = serve({ fetch: app.fetch, port }, (info) => {
  process.stdout.write(`READY:${info.port}\n`);
});

function shutdown(): void {
  if (shutdownOnce) return;
  shutdownOnce = true;

  const hardKill = setTimeout(() => {
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardKill.unref();

  server.close(() => {
    void (async () => {
      if (FORCE_HANG_SQL_END) {
        // Keep the event loop alive so the unref'd hard-kill timer fires.
        // A bare infinite promise has no refs, so Node would exit(0) naturally
        // before the hard-kill deadline — we need a ref'd handle to prevent that.
        const keepAlive = setInterval(() => {}, 60_000);
        await new Promise<never>(() => {
          // never resolves; clearInterval unreachable but silences lint
          void keepAlive;
        });
      }
      await sql.end();
      clearTimeout(hardKill);
      process.exit(0);
    })();
  });
}

process.on("SIGTERM", () => shutdown());
process.on("SIGINT", () => shutdown());
