// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Integration tests for the graceful shutdown chain (LSDS-922).
// Verifies that the full SIGTERM → server.close → sql.end → process.exit(0)
// chain works, and that the hard-kill timer fires process.exit(1) when cleanup
// hangs beyond the deadline.
//
// Each test spawns a real Node.js server process and signals it via SIGTERM.
// No database mocks — the fixture connects to the real test Postgres.

import { describe, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";

const FIXTURE = path.join(import.meta.dirname, "fixtures", "shutdown-fixture.ts");
// tsx binary shipped as a devDependency of apps/api; resolved after `pnpm install`.
const TSX = path.join(import.meta.dirname, "..", "node_modules", ".bin", "tsx");

const DB_URL =
  process.env.DATABASE_URL ?? "postgres://lsds:lsds@localhost:5432/lsds";

/** Pick a free TCP port so concurrent test runs don't collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") return reject(new Error("no addr"));
      srv.close(() => resolve(addr.port));
    });
    srv.on("error", reject);
  });
}

interface FixtureHandle {
  port: number;
  proc: ChildProcess;
}

/**
 * Spawn the fixture and wait until it prints "READY:<port>\n".
 * Rejects if the process exits before signalling readiness.
 */
async function spawnFixture(extraEnv: NodeJS.ProcessEnv = {}): Promise<FixtureHandle> {
  const port = await freePort();

  const proc = spawn(TSX, [FIXTURE], {
    env: {
      ...process.env,
      DATABASE_URL: DB_URL,
      PORT: String(port),
      SKIP_MIGRATIONS: "true",
      LOG_LEVEL: "silent",
      LSDS_ADMIN_SECRET: "test-admin-secret",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    let ready = false;

    proc.stdout!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      if (!ready && text.includes("READY:")) {
        ready = true;
        resolve({ port, proc });
      }
    });

    proc.on("exit", (code) => {
      if (!ready) reject(new Error(`fixture exited prematurely with code ${code}`));
    });

    proc.on("error", reject);

    // Safety: give the fixture 10 s to start before failing.
    setTimeout(() => {
      if (!ready) {
        proc.kill("SIGKILL");
        reject(new Error("fixture did not become ready within 10 s"));
      }
    }, 10_000);
  });
}

/** Wait for a child process to exit and return its exit code. */
function waitExit(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    proc.on("exit", (code) => resolve(code));
  });
}

// ── Happy path ────────────────────────────────────────────────────────────────
//
// Positive: SIGTERM → server drains → sql.end() completes → exit(0) within 2 s.
// Negative: exit code must NOT be 1 (hard-kill did not fire).

describe("graceful shutdown — happy path", () => {
  it("exits with code 0 within 2 s when SIGTERM is sent and no requests are in-flight",
    async () => {
      const { port, proc } = await spawnFixture();

      // Confirm the server is healthy before signalling shutdown.
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      expect(res.status, "server must be up before SIGTERM").toBe(200);

      const exitCode = waitExit(proc);
      proc.kill("SIGTERM");

      const deadline = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2_000));
      const result = await Promise.race([exitCode, deadline]);

      expect(result, "process must exit (not timeout) within 2 s").not.toBe("timeout");
      expect(result, "exit code must be 0 — clean shutdown").toBe(0);
    },
    15_000,
  );

  it(
    "does not exit with code 1 — hard-kill timer must not fire on clean drain",
    async () => {
      const { port, proc } = await spawnFixture();

      await fetch(`http://127.0.0.1:${port}/health`);

      const exitCode = waitExit(proc);
      proc.kill("SIGTERM");

      const code = await Promise.race([
        exitCode,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 2_000)),
      ]);

      expect(code, "hard-kill (exit 1) must not fire on a clean shutdown").not.toBe(1);
      // Clean up if somehow still running after 2 s.
      if (code === "timeout") proc.kill("SIGKILL");
    },
    15_000,
  );
});

// ── Hard-kill path ────────────────────────────────────────────────────────────
//
// Positive: when sql.end() hangs, the 500 ms hard-kill timer fires → exit(1).
// Negative: exit code must NOT be 0 (clean shutdown did not happen).

describe("graceful shutdown — hard-kill path", () => {
  it(
    "exits with code 1 when cleanup hangs beyond the hard-kill deadline",
    async () => {
      const { port, proc } = await spawnFixture({
        FORCE_HANG_SQL_END: "true",
        SHUTDOWN_TIMEOUT_MS: "500", // shorten to keep the test fast
      });

      await fetch(`http://127.0.0.1:${port}/health`);

      const t0 = Date.now();
      const exitCode = waitExit(proc);
      proc.kill("SIGTERM");

      const deadline = new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000));
      const result = await Promise.race([exitCode, deadline]);

      expect(result, "process must exit before the 5 s test deadline").not.toBe("timeout");
      expect(result, "exit code must be 1 — hard-kill fired").toBe(1);
      expect(Date.now() - t0, "exit must not happen before the 500 ms hard-kill timeout").toBeGreaterThanOrEqual(450);
    },
    15_000,
  );

  it(
    "does not exit with code 0 when cleanup hangs — clean shutdown is not possible",
    async () => {
      const { port, proc } = await spawnFixture({
        FORCE_HANG_SQL_END: "true",
        SHUTDOWN_TIMEOUT_MS: "500",
      });

      await fetch(`http://127.0.0.1:${port}/health`);

      const exitCode = waitExit(proc);
      proc.kill("SIGTERM");

      const code = await Promise.race([
        exitCode,
        new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5_000)),
      ]);

      expect(code, "exit(0) must not occur when sql.end() hangs").not.toBe(0);
      if (code === "timeout") proc.kill("SIGKILL");
    },
    15_000,
  );
});
