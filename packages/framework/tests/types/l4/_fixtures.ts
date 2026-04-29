import { tknBase } from "../../fixtures.js";

export const sampleJsonSchema = {
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
} as const;

export const sampleErrorResponse = {
  statusCode: 404,
  errorCode: "NOT_FOUND",
  description: "The requested resource does not exist.",
} as const;

export { tknBase };
