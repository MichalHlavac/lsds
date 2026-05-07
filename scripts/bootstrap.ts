#!/usr/bin/env tsx
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Tenant provisioning bootstrap — first-run setup (local dev entry point).
// In production Docker deployments, use: node apps/api/dist/bootstrap-cli.js
//
// Usage:
//   ADMIN_EMAIL=admin@example.com \
//   ADMIN_PASSWORD=changeme \
//   TENANT_NAME=acme \
//   tsx scripts/bootstrap.ts
//
// Optional env vars (defaults shown):
//   API_URL=http://localhost:3001
//   TENANT_ID=00000000-0000-0000-0000-000000000001

import { run } from "../apps/api/src/bootstrap-cli.js";

await run();
