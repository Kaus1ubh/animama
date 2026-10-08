import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { SCENE_EFFECT_TEMPLATE_OPTIONS } from "@/lib/scene-vfx/editor/defaults";
import {
  AVATAR_EFFECT_TEMPLATE_GROUPS,
  AVATAR_EFFECT_TEMPLATES,
  EFFECT_TEMPLATE_KIND_INFO,
  EFFECT_TEMPLATE_KINDS,
  SCENE_EFFECT_TEMPLATE_IDS,
  avatarEffectTemplate,
  parseAvatarEffectTemplateSearch,
  parseSceneEffectTemplateSearch,
} from "./effectTemplates";
import {
  avatarEffectTemplateThumbnailIds,
  loadAvatarEffectTemplateThumbnail,
} from "./effectTemplateThumbnails";

const includedEffectRoot = fileURLToPath(
  new URL("../../../../../../content/included/vfx/avatar/", import.meta.url),
);
const thumbnailDir = fileURLToPath(
  new URL("../../assets/effect-templates/", import.meta.url),
);

type IncludedDescriptor = { content_id: string; name: string };

async function includedDescriptors(): Promise<Map<string, IncludedDescriptor>> {
  const folders = await readdir(includedEffectRoot, { withFileTypes: true });
  const entries = await Promise.all(
    folders
      .filter((entry) => entry.isDirectory())
      .map(async ({ name }) => {
        const descriptor = JSON.parse(
          await readFile(`${includedEffectRoot}${name}/${name}.json`, "utf8"),
        ) as IncludedDescriptor;
        return [name, descriptor] as const;
      }),
  );
  return new Map(entries);
}

describe("effect template registry", () => {
  it("offers the three kinds with their creator routes", () => {
    expect(EFFECT_TEMPLATE_KINDS).toEqual(["particle", "avatar", "scene"]);
    expect(
      EFFECT_TEMPLATE_KINDS.map((kind) => EFFECT_TEMPLATE_KIND_INFO[kind]),
    ).toMatchObject([
      { label: "Particle FX", route: "/particle-effects/new" },
      { label: "Avatar FX", route: "/avatar-effects/new" },
      { label: "Scene FX", route: "/scene-effects/new" },
    ]);
  });

  it("names every Included Avatar Effect exactly once, by its content ID and name", async () => {
    const descriptors = await includedDescriptors();
    const ids = AVATAR_EFFECT_TEMPLATES.map((template) => template.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...descriptors.keys()].sort());
    for (const template of AVATAR_EFFECT_TEMPLATES) {
      const descriptor = descriptors.get(template.id);
      expect(descriptor?.content_id).toBe(template.contentId);
      expect(descriptor?.name).toBe(template.name);
    }
  });

  it("groups every Avatar template under a known intent, with no empty group", () => {
    const groups = AVATAR_EFFECT_TEMPLATE_GROUPS.map((group) => group.id);
    for (const template of AVATAR_EFFECT_TEMPLATES)
      expect(groups).toContain(template.group);
    for (const group of groups)
      expect(
        AVATAR_EFFECT_TEMPLATES.some((template) => template.group === group),
      ).toBe(true);
  });

  it("lists the Scene creator's starting templates in its order", () => {
    expect(SCENE_EFFECT_TEMPLATE_IDS).toEqual(
      SCENE_EFFECT_TEMPLATE_OPTIONS.map((option) => option.id),
    );
  });

  it("accepts only known template IDs from the route search", () => {
    expect(parseAvatarEffectTemplateSearch({ template: "eye_vv" })).toEqual({
      template: "eye_vv",
    });
    expect(parseAvatarEffectTemplateSearch({ template: "../eye" })).toEqual({});
    expect(parseAvatarEffectTemplateSearch({ template: 3 })).toEqual({});
    expect(parseAvatarEffectTemplateSearch({})).toEqual({});
    expect(parseSceneEffectTemplateSearch({ template: "dark" })).toEqual({
      template: "dark",
    });
    expect(parseSceneEffectTemplateSearch({ template: "eye_vv" })).toEqual({});
    expect(avatarEffectTemplate("star")?.contentId).toBe(
      "builtin:avatar-effect:star",
    );
    expect(avatarEffectTemplate(undefined)).toBeNull();
  });
});

describe("effect template thumbnails", () => {
  it("has a thumbnail for every Avatar template and a template for every thumbnail", async () => {
    const files = (await readdir(thumbnailDir)).filter((name) =>
      name.endsWith(".webp"),
    );
    const ids = AVATAR_EFFECT_TEMPLATES.map((template) => template.id).sort();
    expect(files.map((name) => name.replace(/\.webp$/, "")).sort()).toEqual(
      ids,
    );
    expect(avatarEffectTemplateThumbnailIds()).toEqual(ids);
  });

  it("stores square WebP images of at least 256 px", async () => {
    for (const { id } of AVATAR_EFFECT_TEMPLATES) {
      const metadata = await sharp(`${thumbnailDir}${id}.webp`).metadata();
      expect(metadata.format, id).toBe("webp");
      expect(metadata.width, id).toBeGreaterThanOrEqual(256);
      expect(metadata.height, id).toBe(metadata.width);
    }
  });

  it("loads thumbnails lazily and reports a missing one as absent", async () => {
    await expect(
      loadAvatarEffectTemplateThumbnail("eye_vv_pair"),
    ).resolves.toMatch(/eye_vv_pair\.webp/);
    expect(loadAvatarEffectTemplateThumbnail("missing")).toBeNull();
  });
});
