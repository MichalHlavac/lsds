// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import * as l3 from "../../../src/types/l3/index.js";

describe("L3 module surface", () => {
  it("re-exports the 6 L3 type schemas (kap. 4 § L3)", () => {
    const exported = [
      "ArchitectureSystemSchema",
      "ArchitectureComponentSchema",
      "AdrSchema",
      "ArchitecturePrincipleSchema",
      "QualityAttributeSchema",
      "ExternalSystemSchema",
    ];
    for (const name of exported) {
      expect(l3, `expected L3 module to export ${name}`).toHaveProperty(name);
    }
  });

});
