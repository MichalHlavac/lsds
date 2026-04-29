import { describe, expect, it } from "vitest";
import {
  UI_FLOW_PLATFORMS,
  UI_FLOW_TRAVERSAL_WEIGHT,
  UiFlowSchema,
} from "../../../src/types/l4/ui-flow.js";
import { expectIssue, sampleTeam } from "../../fixtures.js";
import { tknBase } from "./_fixtures.js";

const baseFlow = {
  ...tknBase({ type: "UIFlow", layer: "L4", name: "checkout-flow" }),
  description: "Web checkout from cart through payment confirmation.",
  platform: "WEB" as const,
  entryCondition: "User has at least one item in their cart and is signed in.",
  successCondition: "Order is placed and confirmation page is shown.",
  steps: [
    {
      id: "review-cart",
      name: "Review cart",
      description: "Show cart contents, totals, and shipping address.",
      nextStepIds: ["enter-payment"],
    },
    {
      id: "enter-payment",
      name: "Enter payment",
      description: "Capture card details or saved payment method.",
      nextStepIds: ["confirmation"],
    },
    {
      id: "confirmation",
      name: "Confirmation",
      description: "Display order id and email confirmation.",
      nextStepIds: [],
    },
  ],
  owner: sampleTeam,
};

describe("UIFlow (kap. 4 § L4)", () => {
  it("accepts a fully populated 3-step flow", () => {
    expect(UiFlowSchema.parse(baseFlow)).toMatchObject({
      type: "UIFlow",
      layer: "L4",
      platform: "WEB",
    });
  });

  it("requires at least one step", () => {
    expectIssue(
      UiFlowSchema.safeParse({ ...baseFlow, steps: [] }),
      /at least one step/,
    );
  });

  it("rejects step ids that are not lower-kebab-case", () => {
    expectIssue(
      UiFlowSchema.safeParse({
        ...baseFlow,
        steps: [{ ...baseFlow.steps[0], id: "ReviewCart" }],
      }),
      /lower-kebab-case/,
    );
  });

  it("rejects duplicate step ids", () => {
    expectIssue(
      UiFlowSchema.safeParse({
        ...baseFlow,
        steps: [
          baseFlow.steps[0],
          { ...baseFlow.steps[1], id: "review-cart", nextStepIds: [] },
        ],
      }),
      /unique within the flow/,
    );
  });

  it("rejects nextStepIds referencing unknown step", () => {
    expectIssue(
      UiFlowSchema.safeParse({
        ...baseFlow,
        steps: [
          { ...baseFlow.steps[0], nextStepIds: ["nope"] },
          baseFlow.steps[1],
          baseFlow.steps[2],
        ],
      }),
      /references unknown step id 'nope'/,
    );
  });

  it("rejects unknown platform (closed enum)", () => {
    expectIssue(
      UiFlowSchema.safeParse({ ...baseFlow, platform: "PRINTER" }),
      /Invalid enum value/,
    );
  });

  it("declares LAZY traversal weight", () => {
    expect(UI_FLOW_TRAVERSAL_WEIGHT).toBe("LAZY");
  });

  it("exposes 5 supported platforms", () => {
    expect(UI_FLOW_PLATFORMS).toEqual(["WEB", "IOS", "ANDROID", "DESKTOP", "TERMINAL"]);
  });
});
