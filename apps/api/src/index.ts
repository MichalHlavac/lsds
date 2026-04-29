// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env["PORT"] ?? 3001);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`LSDS API listening on http://localhost:${info.port}`);
});
