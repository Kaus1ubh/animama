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
    description: "Add art on the face, the body or beside the Avatar.",
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
  | "cheeks"
  | "whole-face"
  | "around-head"
  | "mouth"
  | "body";

/** Avatar template groups, by what the effect changes, in picker order. */
export const AVATAR_EFFECT_TEMPLATE_GROUPS: ReadonlyArray<{
  id: AvatarEffectTemplateGroup;
  label: string;
}> = [
  { id: "eyes", label: "Eyes" },
  { id: "cheeks", label: "Cheeks" },
  { id: "whole-face", label: "Whole face" },
  { id: "around-head", label: "Around the head" },
  { id: "mouth", label: "Mouth" },
  { id: "body", label: "Body" },
];

export type AvatarEffectTemplate = {
  /** The Included folder stem; also the `?template=` value and thumbnail name. */
  id: string;
  /** The Included Avatar Effect this template copies. */
  contentId: `builtin:avatar-effect:${string}`;
  /** The Included effect's name, shown before its content is loaded. */
  name: string;
  group: AvatarEffectTemplateGroup;
  /**
   * Thumbnail capture: `framing` is the head (default) or `wide` for art on
   * the chest or beside the head that a head framing would crop; `time`
   * (seconds after applying, default 1) for looping art that is faded out at
   * 1 s. `clip` names an Included Gesture (its folder stem) that poses Annie,
   * for art attached to a hand that hangs out of frame at rest: the clip is
   * sampled at `time` with the effect applied at 0, as
   * `effects:render --with-clip` does.
   */
  thumbnail?: { framing?: "wide"; time?: number; clip?: string };
};

function included(
  id: string,
  name: string,
  group: AvatarEffectTemplateGroup,
  thumbnail?: AvatarEffectTemplate["thumbnail"],
): AvatarEffectTemplate {
  return {
    id,
    contentId: `builtin:avatar-effect:${id}`,
    name,
    group,
    ...(thumbnail ? { thumbnail } : {}),
  };
}

export const AVATAR_EFFECT_TEMPLATES: readonly AvatarEffectTemplate[] = [
  included("eye_vv", "Eye VV", "eyes"),
  included("eye_o", "Eye O", "eyes"),
  included("eye_0", "Eye 0", "eyes"),
  included("eye", "Eye =", "eyes"),
  included("eye_confused_swirl", "Eye Confused Swirl", "eyes"),
  included("star3", "Star3", "eyes"),
  included("heart_eyes", "Heart Eyes", "eyes"),
  included("blush", "Blush", "cheeks"),
  included("blush_band", "Blush Band", "cheeks"),
  included("blush_deep", "Blush Deep", "cheeks"),
  included("streaming_tears", "Streaming Tears", "cheeks"),
  included("single_tear", "Single Tear", "cheeks", { time: 1.2 }),
  included("texture_sick_1", "Texture Sick 1", "whole-face"),
  included("texture_sick_2", "Texture Sick 2", "whole-face"),
  included("texture_black_1", "Texture Black 1", "whole-face"),
  included("face_red", "Red Face", "whole-face"),
  included("angry", "Angry", "around-head"),
  included("emote", "Emote !", "around-head"),
  included("emote_question", "Emote Question", "around-head", { time: 0.3 }),
  included("sparkle_pop", "Sparkle Pop", "around-head", { time: 0.66 }),
  included("sweat_drop", "Sweat Drop", "around-head"),
  included("gloom_lines", "Gloom Lines", "around-head"),
  included("steam_puffs", "Steam Puffs", "around-head", {
    framing: "wide",
    time: 1.5,
  }),
  included("doki_doki", "Doki Doki", "around-head", { framing: "wide" }),
  included("idea_bulb", "Idea Bulb", "around-head", { framing: "wide" }),
  included("huff_puff", "Huff Puff", "around-head", { time: 0.3 }),
  included("sigh_puff", "Sigh Puff", "around-head", { time: 0.5 }),
  included("heh", "Heh", "around-head", { time: 0.5 }),
  included("mouth_w", "Mouth w", "mouth"),
  included("mouth_hover_w", "Mouth Hover w", "mouth"),
  included("heart_throb", "Heart Throb", "body", { framing: "wide" }),
  included("despair_shade", "Despair Shade", "body"),
  included("idea_bulb_fingertip", "Idea Bulb Fingertip", "body", {
    framing: "wide",
    clip: "have-an-idea",
    time: 3,
  }),
  included("finger_heart_pop", "Finger Heart Pop", "body", {
    framing: "wide",
    clip: "finger-heart-pose",
    time: 1,
  }),
];

/** The Scene creator's starting templates, in its own order. */
export const SCENE_EFFECT_TEMPLATE_IDS: readonly SceneEffectTemplateId[] = [
  "shoujo-bloom",
  "radiance",
  "festive-pop",
  "anticipation",
  "shock",
  "rage",
  "queasy",
  "gloom",
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
