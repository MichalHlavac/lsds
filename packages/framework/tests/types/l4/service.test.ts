// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  SERVICE_AUTHENTICATION_SCHEMES,
  SERVICE_TRAVERSAL_WEIGHT,
  SERVICE_TYPES,
  ServiceSchema,
  VERSION_STRATEGIES,
} from "../../../src/types/l4/service.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseService = {
  ...tknBase({ type: "Service", layer: "L4", name: "billing-service" }),
  description: "Public REST surface for billing — invoices, charges, refunds.",
  owner: sampleTeam,
  serviceType: "REST_API" as const,
  versionStrategy: "URL_VERSIONING" as const,
  authentication: "OAUTH2" as const,
};

describe("Service (kap. 4 § L4)", () => {
  it("accepts a fully populated REST_API service", () => {
    expect(ServiceSchema.parse(baseService)).toMatchObject({
      type: "Service",
      layer: "L4",
      serviceType: "REST_API",
    });
  });

  it("rejects unknown serviceType (closed enum)", () => {
    expectIssue(
      ServiceSchema.safeParse({ ...baseService, serviceType: "WEBSOCKET" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown versionStrategy", () => {
    expectIssue(
      ServiceSchema.safeParse({ ...baseService, versionStrategy: "QUERY_PARAM" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown authentication scheme", () => {
    expectIssue(
      ServiceSchema.safeParse({ ...baseService, authentication: "BASIC" }),
      /Invalid enum value/,
    );
  });

  it("rejects empty description", () => {
    expectIssue(
      ServiceSchema.safeParse({ ...baseService, description: "" }),
      /String must contain at least 1/,
    );
  });

  it("rejects layer mismatch (Service must declare layer=L4)", () => {
    expectIssue(
      ServiceSchema.safeParse({ ...baseService, layer: "L3" }),
      /Invalid literal value/,
    );
  });

  it("declares EAGER traversal weight", () => {
    expect(SERVICE_TRAVERSAL_WEIGHT).toBe("EAGER");
  });

  it("exposes 6 service types, 3 version strategies, 5 authentication schemes (kap. 4 closed enums)", () => {
    expect(SERVICE_TYPES).toHaveLength(6);
    expect(VERSION_STRATEGIES).toHaveLength(3);
    expect(SERVICE_AUTHENTICATION_SCHEMES).toHaveLength(5);
  });
});
