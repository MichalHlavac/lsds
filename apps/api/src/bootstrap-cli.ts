// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.
//
// Tenant provisioning bootstrap — first-run setup.
// Provisions: admin user + first API key for a fresh deployment.
//
// Usage (local dev): ADMIN_EMAIL=... ADMIN_PASSWORD=... tsx scripts/bootstrap.ts
// Usage (Docker):    node apps/api/dist/bootstrap-cli.js

import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export interface BootstrapOptions {
  apiUrl: string;
  tenantId: string;
  tenantName: string;
  adminEmail: string;
}

export interface BootstrapResult {
  alreadyProvisioned: boolean;
  apiKey?: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Provision tenant: create admin user + first API key.
 * Idempotent — returns { alreadyProvisioned: true } when active keys already exist.
 * Accepts a custom fetcher for testability (defaults to global fetch).
 */
export async function bootstrap(
  opts: BootstrapOptions,
  fetcher: FetchFn = fetch,
): Promise<BootstrapResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-tenant-id": opts.tenantId,
  };

  // Check if already provisioned: any active API keys for this tenant?
  const keysRes = await fetcher(`${opts.apiUrl}/v1/api-keys`, { headers });
  if (!keysRes.ok) {
    throw new Error(
      `Failed to check existing keys (${keysRes.status}): ${await keysRes.text()}`,
    );
  }
  const { data: existingKeys } = (await keysRes.json()) as {
    data: { id: string; revokedAt: string | null }[];
  };

  if (existingKeys.some((k) => !k.revokedAt)) {
    return { alreadyProvisioned: true };
  }

  // Create admin user (upsert — safe to re-run)
  const userRes = await fetcher(`${opts.apiUrl}/v1/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      externalId: opts.adminEmail,
      displayName: opts.adminEmail,
      email: opts.adminEmail,
      role: "admin",
    }),
  });
  if (!userRes.ok) {
    throw new Error(
      `Failed to create admin user (${userRes.status}): ${await userRes.text()}`,
    );
  }

  // Issue first API key
  const keyRes = await fetcher(`${opts.apiUrl}/v1/api-keys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name: "bootstrap-admin" }),
  });
  if (!keyRes.ok) {
    throw new Error(
      `Failed to create API key (${keyRes.status}): ${await keyRes.text()}`,
    );
  }
  const { data: keyData } = (await keyRes.json()) as { data: { key: string } };

  return { alreadyProvisioned: false, apiKey: keyData.key };
}

export async function run(): Promise<void> {
  const apiUrl = process.env["API_URL"] ?? "http://localhost:3001";
  const tenantId = process.env["TENANT_ID"] ?? "00000000-0000-0000-0000-000000000001";
  const tenantName = process.env["TENANT_NAME"] ?? "default";
  const adminEmail = process.env["ADMIN_EMAIL"];
  const adminPassword = process.env["ADMIN_PASSWORD"];

  if (!adminEmail) {
    console.log("skipping: ADMIN_EMAIL not set — set ADMIN_EMAIL in .env to provision");
    process.exit(0);
  }
  if (!adminPassword) {
    console.error("Error: ADMIN_PASSWORD is required when ADMIN_EMAIL is set");
    process.exit(1);
  }

  // Verify API reachability (API checks DB internally; 503 = DB unreachable)
  let healthRes: Response;
  try {
    healthRes = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(10_000) });
  } catch (err) {
    console.error(`Error: API not reachable at ${apiUrl}/health — is the database up?`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  if (!healthRes.ok) {
    const body = await healthRes.json().catch(() => ({})) as Record<string, unknown>;
    const dbStatus = (body as Record<string, unknown>)["db"] ?? "unknown";
    console.error(
      `Error: API health check failed (${healthRes.status}) — database: ${dbStatus}`,
    );
    process.exit(1);
  }

  let result: BootstrapResult;
  try {
    result = await bootstrap({ apiUrl, tenantId, tenantName, adminEmail });
  } catch (err) {
    console.error("Error:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  if (result.alreadyProvisioned) {
    console.log("already provisioned");
    process.exit(0);
  }

  console.log(`Tenant "${tenantName}" provisioned`);
  console.log(`  Tenant ID:  ${tenantId}`);
  console.log(`  Admin user: ${adminEmail}`);
  console.log(`  API key:    ${result.apiKey}`);
  console.log("");
  console.log("Add to your environment:");
  console.log(`  LSDS_API_KEY=${result.apiKey}`);
}

// Self-invoke when this file is the process entry point
const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? "") === __filename) {
  run().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
