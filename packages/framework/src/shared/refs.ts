// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Michal Hlavac. All rights reserved.

import { z } from "zod";

export const UuidSchema = z.string().uuid();
export type Uuid = z.infer<typeof UuidSchema>;

export const SemverSchema = z
  .string()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/, "must be a SemVer string");
export type Semver = z.infer<typeof SemverSchema>;

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const TeamRefSchema = z.object({
  kind: z.literal("team"),
  id: z.string().min(1),
  name: z.string().min(1),
});
export type TeamRef = z.infer<typeof TeamRefSchema>;

export const PersonRefSchema = z.object({
  kind: z.literal("person"),
  id: z.string().min(1),
  name: z.string().min(1),
});
export type PersonRef = z.infer<typeof PersonRefSchema>;

export const RepoRefSchema = z.object({
  kind: z.literal("repo"),
  url: z.string().url(),
  path: z.string().optional(),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const TechnologyRefSchema = z.object({
  kind: z.literal("technology"),
  name: z.string().min(1),
  version: z.string().optional(),
});
export type TechnologyRef = z.infer<typeof TechnologyRefSchema>;

export const TknRefSchema = z.object({
  kind: z.literal("tkn"),
  type: z.string().min(1),
  id: UuidSchema,
});
export type TknRef = z.infer<typeof TknRefSchema>;

export const TestRefSchema = z.object({
  kind: z.literal("test"),
  id: UuidSchema,
});
export type TestRef = z.infer<typeof TestRefSchema>;

export const SloRefSchema = z.object({
  kind: z.literal("slo"),
  id: UuidSchema,
});
export type SloRef = z.infer<typeof SloRefSchema>;
