// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { tknBase } from "../../fixtures.js";

export const sampleJsonSchema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
} as const;

export const sampleErrorResponse = {
  statusCode: 404,
  errorCode: "NOT_FOUND",
  description: "The requested resource does not exist.",
} as const;

export { tknBase };
