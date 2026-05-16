// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Vitest config for opt-in performance smoke tests (@perf suite).
// These tests are excluded from the default `pnpm test` run because they
// require testcontainers and take several minutes to complete.
//
// Usage:  pnpm --filter @lsds/api test:perf
//     or: pnpm test:perf  (from workspace root)

import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@lsds/framework": path.resolve(__dirname, "../../packages/framework/src/index.ts"),
      "@lsds/shared": path.resolve(__dirname, "../../packages/shared/src/index.ts"),
    },
  },
  test: {
    // Only pick up *.perf.ts files — excluded from the default *.test.ts glob.
    include: ["tests/**/*.perf.ts"],
    environment: "node",
    // No globalSetup: perf tests manage their own Postgres via testcontainers.
    env: {
      LOG_LEVEL: "silent",
      LSDS_ADMIN_SECRET: "test-admin-secret",
    },
  },
});
