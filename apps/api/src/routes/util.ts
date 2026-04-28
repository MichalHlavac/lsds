import type { Context } from "hono";

export function getTenantId(c: Context): string {
  const tenantId = c.req.header("x-tenant-id");
  if (!tenantId) throw new Error("missing x-tenant-id header");
  return tenantId;
}
