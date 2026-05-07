// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { TeamRefSchema } from "../../shared/refs.js";
import { JsonSchemaRefSchema } from "./api-endpoint.js";

export const DATA_CONTRACT_FORMATS = [
  "JSON_SCHEMA",
  "AVRO",
  "PROTOBUF",
  "PARQUET_SCHEMA",
  "CSV",
] as const;
export const DataContractFormatSchema = z.enum(DATA_CONTRACT_FORMATS);
export type DataContractFormat = z.infer<typeof DataContractFormatSchema>;

export const DATA_CONTRACT_FRESHNESS = [
  "REAL_TIME",
  "STREAM",
  "MICRO_BATCH",
  "BATCH_HOURLY",
  "BATCH_DAILY",
  "BATCH_WEEKLY",
] as const;
export const DataContractFreshnessSchema = z.enum(DATA_CONTRACT_FRESHNESS);
export type DataContractFreshness = z.infer<typeof DataContractFreshnessSchema>;

export const DATA_CONTRACT_CLASSIFICATIONS = [
  "PUBLIC",
  "INTERNAL",
  "CONFIDENTIAL",
  "RESTRICTED",
] as const;
export const DataContractClassificationSchema = z.enum(DATA_CONTRACT_CLASSIFICATIONS);
export type DataContractClassification = z.infer<typeof DataContractClassificationSchema>;

// Coarse retention duration: <number><unit>. Unit ∈ {d, w, m, y}.
// Stricter parsing belongs to a dedicated duration type once we have one;
// at this layer we only enforce the shape so callers don't store free text.
const RETENTION_PATTERN = /^\d+(d|w|m|y)$/;

export const DataContractSchema = TknBaseSchema.extend({
  type: z.literal("DataContract"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  owner: TeamRefSchema,
  format: DataContractFormatSchema,
  schema: JsonSchemaRefSchema,
  freshness: DataContractFreshnessSchema,
  classification: DataContractClassificationSchema,
  retention: z
    .string()
    .regex(
      RETENTION_PATTERN,
      "DataContract.retention must match <number><d|w|m|y> (e.g. '30d', '12m', '7y')",
    ),
  slaReference: z.string().optional(),
}).superRefine((value, ctx) => {
  // RESTRICTED data must declare an SLA / processing reference so
  // downstream consumers and auditors know who handles incidents.
  if (value.classification === "RESTRICTED" && !value.slaReference) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "DataContract.slaReference is required when classification=RESTRICTED (audit trail)",
      path: ["slaReference"],
    });
  }
});
export type DataContract = z.infer<typeof DataContractSchema>;

