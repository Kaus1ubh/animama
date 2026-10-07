/**
 * Starting points offered by the Effects template picker.
 *
 * - **Avatar FX** templates are curated Included Avatar Effects, named by
 *   content ID and grouped by what they change. Their Annie thumbnails live in
 *   `assets/effect-templates/<id>.webp`; `pnpm -s effects:thumbnails`
 *   regenerates them from this list.
 * - **Scene FX** templates are the Scene creator's existing starting templates
 *   (`lib/scene-vfx/editor/defaults.ts`), referenced by ID.
 * - **Particle FX** offers only Start from scratch until it has templates.
 *
 * Choosing a template opens the kind's `/new` route with `?template=<id>`, which
 * seeds a new, unsaved Local draft; Included content is never modified.
 *
 * This module has no runtime imports, so the thumbnail script can import it
 * directly with Node's TypeScript type stripping.
 */
import type { SceneEffectTemplateId } from "@/lib/scene-vfx/editor/types";

export type EffectTemplateKind = "particle" | "avatar" | "scene";

/** Picker order of the effect kinds. */
export const EFFECT_TEMPLATE_KINDS: readonly EffectTemplateKind[] = [
  "particle",
  "avatar",
  "scene",
];

export type EffectCreatorRoute =
  | "/particle-effects/new"
  | "/avatar-effects/new"
  | "/scene-effects/new";

export type EffectTemplateKindInfo = {
  label: string;
  description: string;
  /** The creator's `/new` route; templates add `?template=<id>`. */
  route: EffectCreatorRoute;
};

export const EFFECT_TEMPLATE_KIND_INFO: Record<
  EffectTemplateKind,
  EffectTemplateKindInfo
> = {
  particle: {
    label: "Particle FX",
    description: "Add bursts, trails, and atmospheric particles.",
    route: "/particle-effects/new",
  },
  avatar: {
    label: "Avatar FX",
    description: "Add face decals, hover art, and Avatar textures.",
    route: "/avatar-effects/new",
  },
  scene: {
    label: "Scene FX",
    description: "Compose backgrounds and focus lines around your Anima.",
    route: "/scene-effects/new",
  },
};

export type AvatarEffectTemplateGroup =
  | "eyes"
  | "whole-face"
  | "above-head"
  | "mouth";

/** Avatar template groups, by what the effect changes, in picker order. */
export const AVATAR_EFFECT_TEMPLATE_GROUPS: ReadonlyArray<{
  id: AvatarEffectTemplateGroup;
  label: string;
}> = [
  { id: "eyes", label: "Eyes" },
  { id: "whole-face", label: "Whole face" },
  { id: "above-head", label: "Above the head" },
  { id: "mouth", label: "Mouth" },
];

export type AvatarEffectTemplate = {
  /** The Included folder stem; also the `?template=` value and thumbnail name. */
  id: string;
  /** The Included Avatar Effect this template copies. */
  contentId: `builtin:avatar-effect:${string}`;
  /** The Included effect's name, shown before its content is loaded. */
  name: string;
  group: AvatarEffectTemplateGroup;
};

function included(
  id: string,
  name: string,
  group: AvatarEffectTemplateGroup,
): AvatarEffectTemplate {
  return { id, contentId: `builtin:avatar-effect:${id}`, name, group };
}

export const AVATAR_EFFECT_TEMPLATES: readonly AvatarEffectTemplate[] = [
  included("eye_vv_pair", "Eye VV Pair", "eyes"),
  included("eye_vv", "Eye VV", "eyes"),
  included("eye_o", "Eye O", "eyes"),
  included("eye_0", "Eye 0", "eyes"),
  included("eye", "Eye =", "eyes"),
  included("eye_confused_swirl", "Eye Confused Swirl", "eyes"),
  included("star", "Star", "eyes"),
  included("star3", "Star3", "eyes"),
  included("texture_sick_1", "Texture Sick 1", "whole-face"),
  included("texture_sick_2", "Texture Sick 2", "whole-face"),
  included("texture_sick_3", "Texture Sick 3", "whole-face"),
  included("texture_black_1", "Texture Black 1", "whole-face"),
  included("angry", "Angry", "above-head"),
  included("emote", "Emote !", "above-head"),
  included("mouth_w", "Mouth w", "mouth"),
  included("mouth_hover_w", "Mouth Hover w", "mouth"),
];

/** The Scene creator's starting templates, in its own order. */
export const SCENE_EFFECT_TEMPLATE_IDS: readonly SceneEffectTemplateId[] = [
  "kawaii-sparkles",
  "shoujo-hearts",
  "comic-pop",
  "dark",
  "light-streak",
];

export function avatarEffectTemplate(
  id: string | undefined,
): AvatarEffectTemplate | null {
  return AVATAR_EFFECT_TEMPLATES.find((template) => template.id === id) ?? null;
}

export function isSceneEffectTemplateId(
  id: unknown,
): id is SceneEffectTemplateId {
  return SCENE_EFFECT_TEMPLATE_IDS.some((template) => template === id);
}

/** Parse `?template=` for the Avatar Effect creator; unknown IDs are dropped. */
export function parseAvatarEffectTemplateSearch(
  search: Record<string, unknown>,
): { template?: string } {
  const template = search.template;
  return typeof template === "string" && avatarEffectTemplate(template)
    ? { template }
    : {};
}

/** Parse `?template=` for the Scene Effect creator; unknown IDs are dropped. */
export function parseSceneEffectTemplateSearch(
  search: Record<string, unknown>,
): { template?: SceneEffectTemplateId } {
  return isSceneEffectTemplateId(search.template)
    ? { template: search.template }
    : {};
}
