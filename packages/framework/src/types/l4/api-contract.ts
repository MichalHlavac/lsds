import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";

export const API_CONTRACT_SPEC_TYPES = [
  "OPENAPI",
  "GRPC_PROTO",
  "GRAPHQL",
  "ASYNCAPI",
  "CUSTOM",
] as const;
export const ApiContractSpecTypeSchema = z.enum(API_CONTRACT_SPEC_TYPES);
export type ApiContractSpecType = z.infer<typeof ApiContractSpecTypeSchema>;

export const ApiContractSchema = TknBaseSchema.extend({
  type: z.literal("APIContract"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  specType: ApiContractSpecTypeSchema,
  // `version` field on TknBase already enforces SemVer; keep contract-level
  // version aligned with that for change-classification (kap. 2.7) consumers.
  specReference: z
    .string()
    .url("APIContract.specReference must be a URL pointing at the canonical spec"),
  breakingChangePolicy: z
    .string()
    .min(
      30,
      "APIContract.breakingChangePolicy must describe how breaking changes are signalled and migrated (≥ 30 chars)",
    ),
});
export type ApiContract = z.infer<typeof ApiContractSchema>;

export const API_CONTRACT_TRAVERSAL_WEIGHT = "EAGER" as const;
