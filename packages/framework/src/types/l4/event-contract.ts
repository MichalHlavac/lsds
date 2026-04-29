import { z } from "zod";
import { TknBaseSchema } from "../../shared/base.js";
import { JsonSchemaRefSchema } from "./api-endpoint.js";

export const ORDERING_GUARANTEES = ["NONE", "PER_KEY", "GLOBAL"] as const;
export const OrderingGuaranteeSchema = z.enum(ORDERING_GUARANTEES);
export type OrderingGuarantee = z.infer<typeof OrderingGuaranteeSchema>;

export const DELIVERY_GUARANTEES = [
  "AT_MOST_ONCE",
  "AT_LEAST_ONCE",
  "EXACTLY_ONCE",
] as const;
export const DeliveryGuaranteeSchema = z.enum(DELIVERY_GUARANTEES);
export type DeliveryGuarantee = z.infer<typeof DeliveryGuaranteeSchema>;

// Best-effort past-tense check at schema level: reject obvious imperative
// verbs (Create…/Update…/Delete…) for event names. The strict semantic
// guardrail (kap. 5) still applies on the catalog side.
const IMPERATIVE_PREFIXES = /^(Create|Update|Delete|Add|Remove|Send|Post|Get|Fetch)([A-Z]|$)/;

export const EventContractSchema = TknBaseSchema.extend({
  type: z.literal("EventContract"),
  layer: z.literal("L4"),
  description: z.string().min(1),
  channel: z
    .string()
    .min(1, "EventContract.channel must name the topic / queue / stream the event flows on"),
  payloadSchema: JsonSchemaRefSchema,
  // kap. 4 invariants: BOTH guarantees MUST be declared so subscribers know
  // whether to expect at-least-once vs exactly-once and per-key vs global
  // ordering.
  orderingGuarantee: OrderingGuaranteeSchema,
  deliveryGuarantee: DeliveryGuaranteeSchema,
}).superRefine((value, ctx) => {
  if (IMPERATIVE_PREFIXES.test(value.name)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "EventContract.name should be past-tense (e.g. 'OrderPlaced', 'InvoiceIssued'); imperative verbs belong on commands",
      path: ["name"],
    });
  }
});
export type EventContract = z.infer<typeof EventContractSchema>;

export const EVENT_CONTRACT_TRAVERSAL_WEIGHT = "EAGER" as const;
