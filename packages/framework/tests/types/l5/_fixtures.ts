// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { tknBase } from "../../fixtures.js";

export const sampleRepo = {
  kind: "repo" as const,
  url: "https://github.com/example/lsds",
  path: "packages/framework",
};

export const sampleTknRef = {
  kind: "tkn" as const,
  type: "ExternalSystem",
  id: "22222222-2222-4222-8222-222222222222",
};

export { tknBase };
