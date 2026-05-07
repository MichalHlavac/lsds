// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
export const SERVICE_TYPES = [
  "REST_API",
  "GRAPHQL",
  "GRPC",
  "EVENT_DRIVEN",
  "BATCH",
  "HYBRID",
] as const;
export const ServiceTypeSchema = z.enum(SERVICE_TYPES);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;

export const VERSION_STRATEGIES = [
  "URL_VERSIONING",
  "HEADER_VERSIONING",
  "CONTENT_NEGOTIATION",
] as const;
export const VersionStrategySchema = z.enum(VERSION_STRATEGIES);
export type VersionStrategy = z.infer<typeof VersionStrategySchema>;

export const SERVICE_AUTHENTICATION_SCHEMES = [
  "NONE",
  "API_KEY",
  "OAUTH2",
  "MTLS",
  "JWT",
] as const;
export const ServiceAuthenticationSchema = z.enum(SERVICE_AUTHENTICATION_SCHEMES);
export type ServiceAuthentication = z.infer<typeof ServiceAuthenticationSchema>;

export const ServiceSchema = TknBaseSchema.extend({
  type: z.literal("Service"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  serviceType: ServiceTypeSchema,
  versionStrategy: VersionStrategySchema,
  authentication: ServiceAuthenticationSchema,
});
export type Service = z.infer<typeof ServiceSchema>;

