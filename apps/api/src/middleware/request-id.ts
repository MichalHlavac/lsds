// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { createMiddleware } from "hono/factory";
import { logger } from "../logger.js";
import type { Logger } from "../logger.js";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    log: Logger;
  }
}

export const requestIdMiddleware = createMiddleware(async (c, next) => {
  const id = c.req.header("X-Request-Id") ?? crypto.randomUUID();
  c.set("requestId", id);
  c.set("log", logger.child({ requestId: id }));
  c.header("X-Request-Id", id);
  await next();
});
