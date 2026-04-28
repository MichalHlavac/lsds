import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

export function getTenantId(c: Context): string {
  const tenantId = c.req.header("x-tenant-id");
  if (!tenantId) throw new HTTPException(400, { message: "missing x-tenant-id header" });
  return tenantId;
}
