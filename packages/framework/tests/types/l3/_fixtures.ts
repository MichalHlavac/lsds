import { tknBase } from "../../fixtures.js";

export const samplePerson = {
  kind: "person" as const,
  id: "p-architect",
  name: "Renée Architect",
};

export const sampleTechnology = {
  kind: "technology" as const,
  name: "PostgreSQL",
  version: "16.2",
};

export const qaRefA = {
  kind: "quality-attribute" as const,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};
export const qaRefB = {
  kind: "quality-attribute" as const,
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

export { tknBase };
