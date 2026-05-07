// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createRemoteJWKSet, jwtVerify } from "jose";
import { createMiddleware } from "hono/factory";
import type { JWTPayload } from "jose";
import { config } from "../config.js";

declare module "hono" {
  interface ContextVariableMap {
    jwtPayload: JWTPayload | undefined;
  }
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks && config.oidcJwksUri) {
    jwks = createRemoteJWKSet(new URL(config.oidcJwksUri));
  }
  return jwks;
}

export const oidcEnabled = Boolean(config.oidcIssuer);

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
      issuer: config.oidcIssuer,
      ...(config.oidcAudience ? { audience: config.oidcAudience } : {}),
    });
    c.set("jwtPayload", payload);
  } catch {
    return c.json({ error: "unauthorized" }, 401);
  }

  return next();
});
