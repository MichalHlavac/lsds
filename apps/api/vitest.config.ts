// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

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
    include: ["tests/**/*.test.ts"],
    environment: "node",
    globalSetup: ["./tests/setup/global-setup.ts"],
    env: {
      LOG_LEVEL: "silent",
      LSDS_ADMIN_SECRET: "test-admin-secret",
      // Resolved at config-load time so that CI's explicit DATABASE_URL is not
      // overwritten by the worker's setupEnv pass. Falls back to the pgvector
      // container port so that local runs without DATABASE_URL stay consistent
      // with global-setup.ts (which also defaults to 5455).
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://lsds:lsds@localhost:5455/lsds",
    },
  },
});
