import { describe, expect, it } from "vitest";

import type {
  AnimaRuntimeCatalogSnapshot,
  RuntimeCatalogEntry,
} from "@/lib/runtime-content/types";

import { shouldGenerateAnimaAvatarPortrait } from "./eligibility";

const entryBase = {
  slot: "primary_model",
  runtime_id: "primary",
  kind: "avatar_model",
  display_name: "Avatar",
  description: null,
  config_schema_version: 1,
  config: {},
  content_revision: "ac1_model",
} as const;
const userModel: RuntimeCatalogEntry = {
  ...entryBase,
  source: { type: "authorized_files", files: [] },
};
const appModel: RuntimeCatalogEntry = {
  ...entryBase,
  source: { type: "public_url", url: "/vrm/test.vrm" },
};
const runtime = {
  effective_revision: "ar1_current",
  avatar_model: userModel,
  profile_image: null,
} as AnimaRuntimeCatalogSnapshot;

describe("shouldGenerateAnimaAvatarPortrait", () => {
  it("permits an already-loaded visible owner model", () => {
    expect(
      shouldGenerateAnimaAvatarPortrait({
        animaId: "anima-1",
        runtimeContent: runtime,
        avatarEntry: userModel,
        avatarReady: true,
        temporaryPreviewModel: false,
      }),
    ).toBe(true);
  });

  it.each([
    ["custom profile", { runtimeContent: { ...runtime, profile_image: {} } }],
    ["App model", { avatarEntry: appModel }],
    ["temporary preview", { temporaryPreviewModel: true }],
    ["model not loaded", { avatarReady: false }],
    ["missing Anima", { animaId: null }],
  ])("suppresses generation for %s", (_label, override) => {
    expect(
      shouldGenerateAnimaAvatarPortrait({
        animaId: "anima-1",
        runtimeContent: runtime,
        avatarEntry: userModel,
        avatarReady: true,
        temporaryPreviewModel: false,
        ...override,
      } as Parameters<typeof shouldGenerateAnimaAvatarPortrait>[0]),
    ).toBe(false);
  });
});
