// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";

export const INFRA_COMPONENT_KINDS = [
  "COMPUTE",
  "STORAGE",
  "DATABASE",
  "CACHE",
  "QUEUE",
  "NETWORK",
  "CDN",
  "LOAD_BALANCER",
  "OTHER",
] as const;
export const InfraComponentKindSchema = z.enum(INFRA_COMPONENT_KINDS);
export type InfraComponentKind = z.infer<typeof InfraComponentKindSchema>;

export const INFRA_ENVIRONMENTS = ["PROD", "STAGING", "DEV", "ALL"] as const;
export const InfraEnvironmentSchema = z.enum(INFRA_ENVIRONMENTS);
export type InfraEnvironment = z.infer<typeof InfraEnvironmentSchema>;

export const InfrastructureComponentSchema = TknBaseSchema.extend({
  type: z.literal("InfrastructureComponent"),
  layer: z.literal("L6"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  kind: InfraComponentKindSchema,
  environment: InfraEnvironmentSchema,
  provider: z.string().min(1, "InfrastructureComponent.provider must name the cloud/platform provider"),
  region: z.string().optional(),
  isManagedService: z.boolean(),
  slaReference: z.string().optional(),
  // Path to Terraform/Pulumi/Crossplane/Helm definition. Required by GR-L6-001.
  iacReference: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  // Production managed services must declare an SLA reference for incident escalation.
  if (value.environment === "PROD" && value.isManagedService && !value.slaReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "InfrastructureComponent.slaReference is required for PROD managed services",
      path: ["slaReference"],
    });
  }
});
export type InfrastructureComponent = z.infer<typeof InfrastructureComponentSchema>;

