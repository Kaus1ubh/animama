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

/** A kind's creator; its label and description are worded by the picker. */
export type EffectTemplateKindInfo = {
  /** The creator's `/new` route; templates add `?template=<id>`. */
  route: EffectCreatorRoute;
};

export const EFFECT_TEMPLATE_KIND_INFO: Record<
  EffectTemplateKind,
  EffectTemplateKindInfo
> = {
  particle: { route: "/particle-effects/new" },
  avatar: { route: "/avatar-effects/new" },
  scene: { route: "/scene-effects/new" },
};

export type AvatarEffectTemplateGroup =
  | "eyes"
  | "cheeks"
  | "whole-face"
  | "around-head"
  | "mouth"
  | "body";

/**
 * Avatar template groups, by what the effect changes, in picker order. The
 * picker words each group.
 */
export const AVATAR_EFFECT_TEMPLATE_GROUPS: readonly AvatarEffectTemplateGroup[] =
  ["eyes", "cheeks", "whole-face", "around-head", "mouth", "body"];

export type AvatarEffectTemplate = {
  /** The Included folder stem; also the `?template=` value and thumbnail name. */
  id: string;
  /** The Included Avatar Effect this template copies. */
  contentId: `builtin:avatar-effect:${string}`;
  /** The Included effect's name, shown before its content is loaded. */
  name: string;
  group: AvatarEffectTemplateGroup;
  /**
   * Thumbnail capture: `framing` is the head (default), `wide` for art on
   * the chest or beside the head that a head framing would crop, or `body`
   * for art at the belly, hips or a lowered hand; `time`
   * (seconds after applying, default 1) for looping art that is faded out at
   * 1 s. `clip` names an Included Gesture (its folder stem) that poses Annie,
   * for art attached to a hand that hangs out of frame at rest or placed for
   * that Gesture's pose: the clip is sampled at `time` with the effect
   * applied at 0, as `effects:render --with-clip` does.
   */
  thumbnail?: { framing?: "wide" | "body"; time?: number; clip?: string };
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
  included("sweat_drop", "Sweat Drop", "around-head"),
  included("gloom_lines", "Gloom Lines", "around-head"),
  included("steam_puffs", "Steam Puffs", "around-head", {
    framing: "wide",
    time: 1.5,
  }),
  included("doki_doki", "Doki Doki", "around-head", { framing: "wide" }),
  included("idea_bulb", "Idea Bulb", "around-head", { framing: "wide" }),
  included("huff_puff", "Huff Puff", "around-head", { time: 0.3 }),
  included("annoyed_scribble", "Annoyed Scribble", "around-head", {
    framing: "wide",
    clip: "simmering-huff",
    time: 2.9,
  }),
  included("bleh_lettering_head", "Bleh Lettering", "around-head", {
    framing: "wide",
    clip: "tongue-out-bleh",
    time: 1.4,
  }),
  included("cheer_sparkles_head", "Cheer Sparkles", "around-head", {
    framing: "wide",
    clip: "celebration",
    time: 1.1,
  }),
  included("cheer_sparkles_head_left", "Cheer Sparkles Left", "around-head", {
    framing: "wide",
    clip: "celebration",
    time: 1.1,
  }),
  included("emphasis_lines_peek", "Emphasis Lines", "around-head", {
    framing: "wide",
    clip: "cover-face-and-peek",
    time: 2.3,
  }),
  included("gloomy_cloud", "Gloomy Cloud", "around-head", {
    framing: "wide",
    clip: "downcast-sigh",
    time: 3.9,
  }),
  included("hearts_burst_kyaa", "Hearts Burst Kyaa", "around-head", {
    framing: "wide",
    clip: "kyaa-hands-on-cheeks",
    time: 1.4,
  }),
  included("hearts_burst_soft", "Hearts Burst Soft", "around-head", {
    framing: "wide",
    clip: "dreamy-gaze",
    time: 4,
  }),
  included("heh_lettering", "Heh Lettering", "around-head", {
    framing: "wide",
    clip: "smug-heh",
    time: 1.5,
  }),
  included("kira_star_head", "Kira Star", "around-head", {
    framing: "wide",
    clip: "peace-over-eye",
    time: 1.6,
  }),
  included("kira_star_tehe", "Kira Star Tehe", "around-head", {
    framing: "wide",
    clip: "tehepero",
    time: 1.2,
  }),
  included("kiss_heart_head", "Kiss Heart", "around-head", {
    framing: "wide",
    clip: "blow-a-kiss",
    time: 1.3,
  }),
  included("laugh_marks", "Laugh Marks", "around-head", {
    framing: "wide",
    clip: "ohohoho-noble-laugh",
    time: 1.6,
  }),
  included("laugh_sparkle", "Laugh Sparkle", "around-head", {
    framing: "wide",
    clip: "ohohoho-noble-laugh",
    time: 1.9,
  }),
  included("mind_blown_burst", "Mind Blown Burst", "around-head", {
    framing: "wide",
    clip: "mind-blown",
    time: 1.6,
  }),
  included("music_notes", "Music Notes", "around-head", {
    framing: "wide",
    clip: "bgm-bob",
    time: 5.3,
  }),
  included("pat_hearts", "Pat Hearts", "around-head", {
    framing: "wide",
    clip: "head-pat",
    time: 1.5,
  }),
  included("paw_prints", "Paw Prints", "around-head", {
    framing: "wide",
    clip: "cat-paws-nya",
    time: 1.2,
  }),
  included("please_sparkle", "Please Sparkle", "around-head", {
    framing: "wide",
    clip: "please-hands",
    time: 1.6,
  }),
  included("question_mark", "Question Mark", "around-head", {
    framing: "wide",
    clip: "thinking-head-scratch",
    time: 1.1,
  }),
  included("rawr_lettering_chest", "Rawr Lettering", "around-head", {
    framing: "wide",
    clip: "cat-monster-rawr",
    time: 1.3,
  }),
  included("shock_marks", "Shock Marks", "around-head", {
    framing: "wide",
    clip: "flex",
    time: 1.8,
  }),
  included("sigh_puff", "Sigh Puff", "around-head", { time: 0.4 }),
  included("sigh_puff_droop", "Sigh Puff Droop", "around-head", { time: 0.5 }),
  included("sly_glint", "Sly Glint", "around-head", {
    clip: "scheming-hands",
    time: 2,
  }),
  included("sorry_lettering", "Sorry Lettering", "around-head", {
    framing: "wide",
    clip: "apology-bow",
    time: 1.4,
  }),
  included("soul_wisp", "Soul Wisp", "around-head", {
    framing: "wide",
    clip: "soul-leaves-body",
    time: 1.3,
  }),
  included("sweat_splash_cower", "Sweat Splash", "around-head", {
    framing: "wide",
    clip: "cower",
    time: 1.3,
  }),
  included("tear_flick_head", "Tear Flick", "around-head", {
    framing: "wide",
    clip: "tear-wipe",
    time: 2.0,
  }),
  included("zzz", "Zzz", "around-head", {
    framing: "wide",
    clip: "sleepy-nod-off",
    time: 2.8,
  }),
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
  included("badum_burst", "Badum Burst", "body", {
    framing: "body",
    clip: "drumroll",
    time: 2.8,
  }),
  included("badum_burst_left", "Badum Burst Left", "body", {
    framing: "body",
    clip: "drumroll",
    time: 2.8,
  }),
  included("drumroll_ticks", "Drumroll Ticks", "body", {
    framing: "wide",
    clip: "have-an-idea",
    time: 3,
  }),
  included("drumroll_ticks_left", "Drumroll Ticks Left", "body", {
    framing: "wide",
    clip: "left-peace-sign",
    time: 1.13,
  }),
  included("finger_gun_spark", "Finger Gun Spark", "body", {
    framing: "wide",
    clip: "cheeky-finger-guns",
    time: 0.7,
  }),
  included("finger_gun_spark_left", "Finger Gun Spark Left", "body", {
    framing: "wide",
    clip: "cheeky-finger-guns",
    time: 0.73,
  }),
  included("fist_bump_burst", "Fist Bump Burst", "body", {
    framing: "body",
    clip: "fist-bump",
    time: 0.8,
  }),
  included("heart_hands_pop_chest", "Heart Hands Pop", "body", {
    framing: "wide",
    clip: "heart-hands-build",
    time: 1,
  }),
  included("hearts_burst_hands", "Hearts Burst Hands", "body", {
    framing: "wide",
    clip: "prayer-hands-thanks",
    time: 1.4,
  }),
  included("high_five_burst", "High Five Burst", "body", {
    framing: "wide",
    clip: "high-five",
    time: 1.0,
  }),
  included("kira_star_wish", "Kira Star Wish", "body", {
    framing: "wide",
    clip: "fingers-crossed",
    time: 1.4,
  }),
  included("kira_star_wish_left", "Kira Star Wish Left", "body", {
    framing: "wide",
    clip: "fingers-crossed",
    time: 1.4,
  }),
  included("scratch_ticks", "Scratch Ticks", "body", {
    framing: "wide",
    clip: "nervous-head-scratch",
    time: 1.2,
  }),
  included("shake_lines", "Shake Lines", "body", {
    framing: "wide",
    clip: "cower",
    time: 1.2,
  }),
  included("shake_lines_left", "Shake Lines Left", "body", {
    framing: "wide",
    clip: "cower",
    time: 1.2,
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
