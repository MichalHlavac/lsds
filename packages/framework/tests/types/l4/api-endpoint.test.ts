// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { describe, expect, it } from "vitest";
import {
  API_ENDPOINT_STATUSES,
  ApiEndpointSchema,
  ErrorResponseSchema,
  HTTP_METHODS,
} from "../../../src/types/l4/api-endpoint.js";
import { expectIssue } from "../../fixtures.js";
import { sampleErrorResponse, sampleJsonSchema, tknBase } from "./_fixtures.js";

const baseEndpoint = {
  ...tknBase({ type: "APIEndpoint", layer: "L4", name: "GET /invoices/{id}" }),
  description: "Fetch a single invoice by id.",
  path: "/invoices/{id}",
  method: "GET" as const,
  responseSchema: sampleJsonSchema,
  errorResponses: [sampleErrorResponse],
  authenticationRequired: true,
  idempotent: true,
  status: "ACTIVE" as const,
};

describe("APIEndpoint (kap. 4 § L4)", () => {
  it("accepts a fully populated GET endpoint", () => {
    expect(ApiEndpointSchema.parse(baseEndpoint)).toMatchObject({
      type: "APIEndpoint",
      layer: "L4",
      method: "GET",
    });
  });

  it("requires responseSchema (kap. 4 invariant)", () => {
    const { responseSchema: _omit, ...withoutSchema } = baseEndpoint;
    const result = ApiEndpointSchema.safeParse(withoutSchema);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.path.join(".") === "responseSchema" && i.message === "Required",
        ),
      ).toBe(true);
    }
  });

  it("requires errorResponses to be non-empty (kap. 4 invariant)", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({ ...baseEndpoint, errorResponses: [] }),
      /errorResponses must contain at least one error response/,
    );
  });

  it("rejects path that does not start with '/'", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({ ...baseEndpoint, path: "invoices/{id}" }),
      /must start with '\/'/,
    );
  });

  it("rejects unknown HTTP method (closed enum)", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({ ...baseEndpoint, method: "OPTIONS" }),
      /Invalid enum value/,
    );
  });

  it("rejects unknown status (closed enum)", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({ ...baseEndpoint, status: "RETIRED" }),
      /Invalid enum value/,
    );
  });

  it("rejects ErrorResponse with statusCode below 400", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({
        ...baseEndpoint,
        errorResponses: [{ ...sampleErrorResponse, statusCode: 200 }],
      }),
      /must be a 4xx or 5xx code/,
    );
  });

  it("rejects ErrorResponse with statusCode above 599", () => {
    expectIssue(
      ApiEndpointSchema.safeParse({
        ...baseEndpoint,
        errorResponses: [{ ...sampleErrorResponse, statusCode: 600 }],
      }),
      /must be a 4xx or 5xx code/,
    );
  });

  it("ErrorResponse requires errorCode and description", () => {
    expectIssue(
      ErrorResponseSchema.safeParse({
        statusCode: 400,
        errorCode: "",
        description: "missing",
      }),
      /errorCode/,
    );
  });

  it("accepts requestSchema as optional", () => {
    const { requestSchema: _omit, ...without } = baseEndpoint as typeof baseEndpoint & {
      requestSchema?: unknown;
    };
    expect(ApiEndpointSchema.parse(without)).toBeTruthy();
  });


  it("exposes 6 HTTP methods including SUBSCRIBE for AsyncAPI / streaming", () => {
    expect(HTTP_METHODS).toEqual(["GET", "POST", "PUT", "PATCH", "DELETE", "SUBSCRIBE"]);
    expect(API_ENDPOINT_STATUSES).toEqual(["ACTIVE", "DEPRECATED", "EXPERIMENTAL"]);
  });
});
