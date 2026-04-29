// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { RepoRefSchema, TeamRefSchema } from "../../shared/refs.js";

export const DEPLOYMENT_UNIT_KINDS = [
  "CONTAINER",
  "SERVERLESS_FUNCTION",
  "VM_IMAGE",
  "STATIC_SITE",
  "LIBRARY",
  "CLI",
  "OTHER",
] as const;
export const DeploymentUnitKindSchema = z.enum(DEPLOYMENT_UNIT_KINDS);
export type DeploymentUnitKind = z.infer<typeof DeploymentUnitKindSchema>;

export const DeploymentUnitSchema = TknBaseSchema.extend({
  type: z.literal("DeploymentUnit"),
  layer: z.literal("L6"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  kind: DeploymentUnitKindSchema,
  imageReference: z.string().optional(),
  repoRef: RepoRefSchema.optional(),
  buildfilePath: z.string().optional(),
  continuousDeployment: z.boolean(),
}).superRefine((value, ctx) => {
  // CONTAINER units must supply either imageReference or buildfilePath so
  // the registry or build source is always traceable.
  if (
    value.kind === "CONTAINER" &&
    !value.imageReference &&
    !value.buildfilePath
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "DeploymentUnit of kind=CONTAINER requires imageReference or buildfilePath",
      path: ["imageReference"],
    });
  }
});
export type DeploymentUnit = z.infer<typeof DeploymentUnitSchema>;

export const DEPLOYMENT_UNIT_TRAVERSAL_WEIGHT = "EAGER" as const;
