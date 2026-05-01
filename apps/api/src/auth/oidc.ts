// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";
import type { JWTPayload } from "jose";

declare module "hono" {
  interface ContextVariableMap {
    jwtPayload: JWTPayload | undefined;
  }
}

const ISSUER = process.env["OIDC_ISSUER"];
const AUDIENCE = process.env["OIDC_AUDIENCE"];
const JWKS_URI = process.env["OIDC_JWKS_URI"] ?? (ISSUER ? `${ISSUER}/.well-known/jwks.json` : undefined);

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks && JWKS_URI) {
    jwks = createRemoteJWKSet(new URL(JWKS_URI));
  }
  return jwks;
}

export const oidcEnabled = Boolean(ISSUER);

export const oidcMiddleware = createMiddleware(async (c, next) => {
  const remoteJwks = getJwks();
  if (!remoteJwks) {
    return next();
  }

  const auth = c.req.header("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const token = auth.slice(7);
  try {
    const { payload } = await jwtVerify(token, remoteJwks, {
      issuer: ISSUER,
      ...(AUDIENCE ? { audience: AUDIENCE } : {}),
    });
    c.set("jwtPayload", payload);
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
});
