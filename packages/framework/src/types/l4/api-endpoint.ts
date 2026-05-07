// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "SUBSCRIBE",
] as const;
export const HttpMethodSchema = z.enum(HTTP_METHODS);
export type HttpMethod = z.infer<typeof HttpMethodSchema>;

export const API_ENDPOINT_STATUSES = ["ACTIVE", "DEPRECATED", "EXPERIMENTAL"] as const;
export const ApiEndpointStatusSchema = z.enum(API_ENDPOINT_STATUSES);
export type ApiEndpointStatus = z.infer<typeof ApiEndpointStatusSchema>;

// `JsonSchemaRef` is a freeform JSON Schema document. We accept any JSON-typed
// object so callers can hand in OpenAPI / JSON Schema fragments; validating
// that the embedded schema is itself a valid JSON Schema is a SEMANTIC
// (descriptive) guardrail concern, not a STRUCTURAL one.
export const JsonSchemaRefSchema = z.record(z.unknown());
export type JsonSchemaRef = z.infer<typeof JsonSchemaRefSchema>;

export const ErrorResponseSchema = z.object({
  statusCode: z
    .number()
    .int()
    .gte(400, "ErrorResponse.statusCode must be a 4xx or 5xx code")
    .lte(599, "ErrorResponse.statusCode must be a 4xx or 5xx code"),
  errorCode: z
    .string()
    .min(1, "ErrorResponse.errorCode must be a stable machine-readable identifier"),
  description: z.string().min(1),
  schema: JsonSchemaRefSchema.optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const ApiEndpointSchema = TknBaseSchema.extend({
  type: z.literal("APIEndpoint"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  path: z
    .string()
    .min(1)
    .regex(/^\//, "APIEndpoint.path must start with '/' (RFC 3986 path-absolute)"),
  method: HttpMethodSchema,
  // kap. 4 invariant: response_schema is REQUIRED — endpoints without a
  // response contract collapse SDK generation, mocks, and consumer tests.
  responseSchema: JsonSchemaRefSchema,
  requestSchema: JsonSchemaRefSchema.optional(),
  // kap. 4 invariant: error_responses MIN 1 — happy-path-only endpoints leave
  // clients to guess the error contract.
  errorResponses: z
    .array(ErrorResponseSchema)
    .min(
      1,
      "APIEndpoint.errorResponses must contain at least one error response (kap. 4 invariant)",
    ),
  authenticationRequired: z.boolean(),
  idempotent: z.boolean(),
  status: ApiEndpointStatusSchema,
});
export type ApiEndpoint = z.infer<typeof ApiEndpointSchema>;

