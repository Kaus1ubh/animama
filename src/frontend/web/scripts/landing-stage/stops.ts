import type { TrackedEmotion } from "@/lib/emotion";

import type { AmbientMood } from "./ambient";

/*
 * The landing page's camera stops (spike). Each stop frames the Avatar for
 * one feature; scrolling moves the camera between consecutive stops. Camera
 * values are relative to the Avatar's rest head height, so another VRM keeps
 * the same framing. The server (`../landing-stage.mjs`) reads this module to
 * resolve the Library sources the page plays.
 */

/** The Included Avatar the stage shows. */
export const STAGE_AVATAR = "AvatarSample_A_1_New";
/** Her name in captions and the memory demo. */
export const STAGE_ANIMA_NAME = "Annie";

/**
 * Where the camera stands for a stop. Lengths are in head heights (the rest
 * height of the head bone), so framing follows the Avatar's size.
 */
export type StageCamera = {
  /**
   * Orbit angle in degrees around the Avatar's vertical axis: 0 is in front
   * of her, 90 at her left, 180 behind. Later stops keep increasing so the
   * orbit never turns back on itself.
   */
  yaw: number;
  /** Distance from the aim point. */
  distance: number;
  /** Height the camera aims at (1 is the head bone). */
  aim: number;
  /** Camera height above the aim point; negative looks up at her. */
  rise: number;
  /** Vertical field of view in degrees. */
  fov: number;
  /**
   * Horizontal lens shift as a share of the frame width; positive moves her
   * right of centre, leaving room for the caption on the left.
   */
  shift: number;
  /**
   * Vertical lens shift as a share of the frame height; positive moves her
   * up, leaving room for a caption below (phones).
   */
  lift: number;
};

/** A Gesture or Reaction a stop plays, with the label its chip shows. */
export type StageClip = {
  label: string;
  /** Library spec of the clip. */
  spec: string;
  /** Emotion mascot shown on the chip (`public/emotions/<file>`). */
  mascot?: string;
  /**
   * Made-up emotional state (0–30 per emotion) the demo shows while the clip
   * plays; unlisted emotions are 0.
   */
  emotion?: Partial<Record<TrackedEmotion, number>>;
};

/** The interactive demo a stop shows beside its caption. */
export type StagePanel = "mascots" | "chips" | "memory" | "creator";

/** A body word, in its stop's accent, that takes the visitor to that stop. */
export type StageLink = {
  word: string;
  /** Id of the stop to scroll to. */
  stop: string;
};

export type StageStop = {
  id: string;
  /** Short name the progress thread shows while the stop is active. */
  label: string;
  /**
   * The stop's colour, used by the hero's link to it: a deeper shade of an
   * app pastel, so it reads as text on the light backdrops.
   */
  accent: string;
  /** Feature caption: a short heading and one supporting line. */
  title: string;
  body?: string;
  /** Words in the body shown in colour that scroll to another stop. */
  links?: StageLink[];
  /** Wide (desktop) framing, and overrides for tall (phone) viewports. */
  camera: StageCamera;
  tall?: Partial<StageCamera>;
  /** CSS background behind the Avatar and any Scene Effect. */
  backdrop: string;
  /** Caption and chrome colour that reads on the backdrop. */
  ink: "dark" | "light";
  /** Twilight lighting: softer, lavender light on the Avatar. */
  dusk?: boolean;
  /**
   * Her eyes, head and upper body follow the visitor's cursor, once the
   * stop's `once` clip has finished.
   */
  followCursor?: boolean;
  /** Particles drifting behind the Avatar (`ambient.ts`); none if unset. */
  ambient?: AmbientMood;
  /**
   * Clips the stop plays. `cycle` plays them in turn and repeats, resuming
   * where the visitor left off; `once` plays the first clip on arrival.
   */
  clips: StageClip[];
  clipMode: "once" | "cycle";
  panel?: StagePanel;
  /**
   * How far (0–1) her upper body and head turn toward the camera when it is
   * behind her, for an over-the-shoulder look back.
   */
  lookBack?: number;
};

/**
 * The page background behind every light stop while the washes below are
 * switched off (the default; `?washes` restores them): the theme's own
 * background, cream in light mode and charcoal in dark mode.
 */
export const PLAIN_BACKDROP = "var(--background)";

/** Pastel washes in the app's palette (cream, sky, blush, lavender, lime). */
const HERO = [
  "radial-gradient(42% 46% at 16% 22%, #ecdfff 0%, transparent 70%)",
  "radial-gradient(40% 44% at 86% 18%, #ffe1ea 0%, transparent 70%)",
  "radial-gradient(60% 50% at 50% 108%, #d9f1fb 0%, transparent 70%)",
  "#faf9f4",
].join(", ");
const BLUSH = [
  "radial-gradient(55% 60% at 72% 40%, #ffe3ec 0%, transparent 70%)",
  "radial-gradient(45% 50% at 12% 85%, #ffeef3 0%, transparent 70%)",
  "linear-gradient(180deg, #fff6f8 0%, #fdeef3 100%)",
].join(", ");
const LAVENDER = [
  "radial-gradient(50% 55% at 70% 35%, #efe6ff 0%, transparent 70%)",
  "radial-gradient(40% 40% at 10% 80%, #f1fbdc 0%, transparent 70%)",
  "linear-gradient(180deg, #faf8ff 0%, #f1ecfb 100%)",
].join(", ");
/** Twilight with tiny stars for the memory stop. */
const TWILIGHT = [
  "radial-gradient(circle at 14% 18%, #fff 0 1.5px, transparent 2.5px)",
  "radial-gradient(circle at 32% 9%, #fff 0 1px, transparent 2px)",
  "radial-gradient(circle at 58% 14%, #fff 0 1.5px, transparent 2.5px)",
  "radial-gradient(circle at 78% 7%, #fff 0 1px, transparent 2px)",
  "radial-gradient(circle at 90% 24%, #fff 0 1.5px, transparent 2.5px)",
  "radial-gradient(circle at 44% 28%, #fff 0 1px, transparent 2px)",
  "radial-gradient(60% 50% at 30% 100%, rgba(255, 190, 215, .55) 0%, transparent 70%)",
  "linear-gradient(180deg, #3d3f8f 0%, #6e5bb5 50%, #c79bd2 100%)",
].join(", ");
const CREAM = [
  "radial-gradient(45% 50% at 80% 30%, #dff3fb 0%, transparent 70%)",
  "radial-gradient(40% 45% at 15% 75%, #ffe6ee 0%, transparent 70%)",
  "#faf9f4",
].join(", ");

/**
 * Made-up emotional state (0–30) shown while a feeling's Reactions play.
 * Every radar group stays at 9 or more so the chart reads as full.
 */
const FEELINGS: Partial<
  Record<TrackedEmotion, Partial<Record<TrackedEmotion, number>>>
> = {
  joy: {
    joy: 28,
    excitement: 23,
    amusement: 20,
    caring: 18,
    love: 16,
    confidence: 19,
    gratitude: 16,
    optimism: 21,
    curiosity: 16,
    nervousness: 13,
    annoyance: 12,
    embarrassment: 14,
    sadness: 12,
  },
  love: {
    love: 28,
    caring: 23,
    admiration: 20,
    joy: 21,
    excitement: 16,
    gratitude: 17,
    desire: 19,
    optimism: 16,
    nervousness: 15,
    embarrassment: 18,
    annoyance: 12,
    sadness: 12,
  },
  caring: {
    caring: 28,
    love: 22,
    admiration: 17,
    gratitude: 19,
    respect: 15,
    joy: 18,
    optimism: 17,
    curiosity: 13,
    nervousness: 13,
    annoyance: 11,
    embarrassment: 13,
    sadness: 14,
  },
  gratitude: {
    gratitude: 28,
    respect: 21,
    confidence: 14,
    caring: 23,
    admiration: 19,
    love: 16,
    joy: 21,
    excitement: 13,
    optimism: 18,
    nervousness: 12,
    embarrassment: 14,
    sadness: 14,
    annoyance: 11,
  },
  desire: {
    desire: 28,
    optimism: 20,
    curiosity: 17,
    love: 22,
    admiration: 18,
    excitement: 20,
    joy: 16,
    embarrassment: 18,
    nervousness: 16,
    confidence: 14,
    annoyance: 12,
    sadness: 12,
  },
  confusion: {
    confusion: 27,
    nervousness: 20,
    fear: 14,
    curiosity: 21,
    optimism: 13,
    amusement: 16,
    embarrassment: 15,
    annoyance: 14,
    confidence: 12,
    caring: 13,
    disappointment: 13,
  },
  nervousness: {
    nervousness: 28,
    fear: 20,
    confusion: 17,
    embarrassment: 21,
    curiosity: 14,
    desire: 13,
    caring: 13,
    confidence: 10,
    annoyance: 12,
    amusement: 12,
    sadness: 12,
  },
  fear: {
    fear: 28,
    nervousness: 23,
    confusion: 16,
    sadness: 17,
    grief: 12,
    embarrassment: 15,
    disgust: 12,
    annoyance: 12,
    caring: 14,
    desire: 12,
    confidence: 10,
    joy: 9,
  },
  annoyance: {
    annoyance: 27,
    disapproval: 20,
    anger: 18,
    disgust: 15,
    disappointment: 17,
    nervousness: 13,
    optimism: 12,
    confidence: 16,
    caring: 12,
    amusement: 12,
  },
  disapproval: {
    disapproval: 27,
    annoyance: 22,
    anger: 15,
    disgust: 16,
    disappointment: 18,
    confusion: 13,
    confidence: 17,
    caring: 12,
    curiosity: 11,
    amusement: 10,
  },
  disgust: {
    disgust: 28,
    embarrassment: 14,
    remorse: 12,
    disapproval: 21,
    annoyance: 17,
    fear: 16,
    confusion: 14,
    disappointment: 15,
    amusement: 12,
    caring: 12,
    confidence: 12,
    curiosity: 12,
  },
  disappointment: {
    disappointment: 27,
    sadness: 21,
    grief: 16,
    annoyance: 17,
    disapproval: 16,
    remorse: 15,
    nervousness: 14,
    confidence: 12,
    optimism: 12,
    caring: 13,
    amusement: 11,
  },
  sadness: {
    sadness: 28,
    grief: 21,
    disappointment: 19,
    caring: 17,
    love: 13,
    fear: 14,
    nervousness: 16,
    remorse: 16,
    gratitude: 12,
    optimism: 12,
    annoyance: 12,
    amusement: 11,
  },
  grief: {
    grief: 28,
    sadness: 24,
    disappointment: 18,
    remorse: 17,
    love: 16,
    caring: 15,
    fear: 14,
    nervousness: 13,
    gratitude: 11,
    desire: 11,
    annoyance: 10,
    joy: 9,
  },
};

/** Reaction intensity names by level (the `-1` to `-4` in a Reaction id). */
const INTENSITIES = ["Mild", "Moderate", "Strong", "Intense"];

/**
 * A Reaction chip, labelled "Joy (Strong)": its feeling's mascot and made-up
 * emotional state.
 */
const reaction = (stem: string, feeling: TrackedEmotion): StageClip => {
  const level = Number(/-(\d)(?:-b)?$/.exec(stem)?.[1]);
  const name = feeling.charAt(0).toUpperCase() + feeling.slice(1);
  return {
    label: `${name} (${INTENSITIES[level - 1]})`,
    spec: `library:included/${stem}`,
    mascot: `${feeling}-very.webp`,
    emotion: FEELINGS[feeling],
  };
};
const gesture = (stem: string, label: string): StageClip => ({
  label,
  spec: `library:included/${stem}`,
});

export const STAGE_STOPS: StageStop[] = [
  {
    id: "hero",
    accent: "#8b7cf6",
    label: "Meet",
    followCursor: true,
    title: "Meet your Anima",
    body: "An AI companion who moves, feels and remembers you",
    links: [
      { word: "feels", stop: "emotion" },
      { word: "moves", stop: "gestures" },
      { word: "remembers", stop: "memory" },
    ],
    camera: {
      yaw: 0,
      distance: 0.74,
      aim: 1.12,
      rise: 0,
      fov: 30,
      shift: 0,
      lift: 0.06,
    },
    tall: { distance: 0.94, lift: -0.02 },
    backdrop: HERO,
    ink: "dark",
    clips: [gesture("small-shy-wave", "Small wave")],
    clipMode: "once",
  },
  {
    id: "gestures",
    accent: "#2f9fd0",
    label: "Moves",
    title: "She talks with her hands",
    body: "152 gestures and 168 reactions, chosen as she speaks.",
    camera: {
      yaw: 16,
      distance: 1.25,
      aim: 0.86,
      rise: -0.04,
      fov: 30,
      shift: 0.16,
      lift: -0.06,
    },
    tall: { distance: 2.3, shift: 0, lift: 0.22 },
    backdrop: LAVENDER,
    ink: "dark",
    clips: [
      gesture("lean-in-coy", "Coy lean"),
      gesture("soul-leaves-body", "Soul leaves"),
      gesture("flustered-fan", "Flustered fan"),
      gesture("innocent-whistle", "Innocent whistle"),
      gesture("finger-heart-pose", "Finger heart"),
      gesture("double-peace-pop", "Double peace"),
      gesture("nervous-head-scratch", "Head scratch"),
      gesture("dramatic-swoon", "Dramatic swoon"),
      gesture("snicker-laugh", "Snicker"),
    ],
    clipMode: "cycle",
    panel: "chips",
  },
  {
    id: "emotion",
    accent: "#e8557c",
    label: "Feels",
    followCursor: true,
    title: "She feels the conversation",
    body: "Every reply shifts her emotional state, and her face, effects and mood follow.",
    camera: {
      yaw: 25,
      distance: 0.62,
      aim: 1.06,
      rise: 0.01,
      fov: 30,
      shift: 0.09,
      lift: 0,
    },
    tall: { distance: 1.05, shift: 0, aim: 1.02, lift: 0.24 },
    backdrop: BLUSH,
    ink: "dark",
    clips: [
      reaction("desire-3-b", "desire"),
      reaction("caring-3-b", "caring"),
      reaction("joy-3-b", "joy"),
      reaction("confusion-3", "confusion"),
      reaction("fear-3", "fear"),
      reaction("sadness-3", "sadness"),
      reaction("disapproval-3-b", "disapproval"),
      reaction("disgust-3-b", "disgust"),
    ],
    clipMode: "cycle",
    panel: "mascots",
  },
  {
    id: "memory",
    accent: "#68a614",
    label: "Remembers",
    title: "She remembers your story",
    body: "Your profile, her identity and your story together live in notes you can read, edit and roll back.",
    camera: {
      yaw: 160,
      distance: 0.9,
      aim: 0.98,
      rise: 0.06,
      fov: 30,
      shift: -0.2,
      lift: 0,
    },
    tall: { distance: 1.45, shift: 0, lift: 0.22 },
    ambient: "stars",
    backdrop: TWILIGHT,
    ink: "light",
    dusk: true,
    clips: [],
    clipMode: "once",
    panel: "memory",
    lookBack: 1,
  },
  {
    id: "effects",
    accent: "#f0961e",
    label: "Create",
    title: "Make your own effects",
    body: "Layer backgrounds and particles in the creators, then add them to any gesture or reaction.",
    camera: {
      yaw: 360,
      distance: 1.9,
      aim: 0.8,
      rise: -0.12,
      fov: 30,
      shift: 0.04,
      lift: 0,
    },
    tall: { distance: 3, shift: 0, lift: 0.17 },
    backdrop: CREAM,
    ink: "dark",
    clips: [],
    clipMode: "once",
    panel: "creator",
  },
  {
    id: "download",
    accent: "#8b7cf6",
    label: "Download",
    title: "Meet her on your desktop",
    body: "Coming soon to macOS and Windows.",
    camera: {
      yaw: 372,
      distance: 1.2,
      aim: 0.92,
      rise: 0,
      fov: 30,
      shift: 0.2,
      lift: 0,
    },
    tall: { distance: 1.85, shift: 0, lift: 0.17 },
    backdrop: HERO,
    ink: "dark",
    clips: [gesture("goodbye-wave", "Goodbye wave")],
    clipMode: "once",
  },
];

/** The Scene Effect whose layers the creator demo switches on and off. */
export const CREATOR_SCENE =
  "library:scene-effect/included/scene-vfx-emotion-joy";

/** Background layers the creator demo exposes. */
export const CREATOR_LAYERS = [
  { id: "gradient", label: "Gradient" },
  { id: "pattern", label: "Polka dots" },
  { id: "rays", label: "Rays" },
  { id: "stars", label: "Pop stars" },
  { id: "confetti", label: "Confetti" },
] as const;
export type CreatorLayerId = (typeof CREATOR_LAYERS)[number]["id"];

/** Two-stop gradient palettes from the app's colours. */
export const CREATOR_PALETTES = [
  { id: "sunny", label: "Sunny", stops: ["#fff27a", "#ffb547"] },
  { id: "blush", label: "Blush", stops: ["#ffe0ea", "#ff99cc"] },
  { id: "sky", label: "Sky", stops: ["#e0f5ff", "#86cfea"] },
  { id: "lavender", label: "Lavender", stops: ["#f1e8ff", "#b9a3ff"] },
  { id: "lime", label: "Lime", stops: ["#f6ffe0", "#c6ef6e"] },
] as const;
export type CreatorPaletteId = (typeof CREATOR_PALETTES)[number]["id"];

/** Particle Effects the creator demo can add, with their tile icons. */
export const CREATOR_PARTICLES = [
  {
    id: "hearts",
    label: "Hearts",
    spec: "library:particle-effect/included/heart-burst",
  },
  {
    id: "sparkles",
    label: "Sparkles",
    spec: "library:particle-effect/included/sparkle-hearts",
  },
  {
    id: "flowers",
    label: "Flowers",
    spec: "library:particle-effect/included/flower-pop",
  },
  {
    id: "confetti",
    label: "Confetti",
    spec: "library:particle-effect/included/confetti",
  },
  {
    id: "stars",
    label: "Star burst",
    spec: "library:particle-effect/included/star-burst",
  },
  {
    id: "butterflies",
    label: "Butterflies",
    spec: "library:particle-effect/included/butterfly-flutter",
  },
] as const;
export type CreatorParticleId = (typeof CREATOR_PARTICLES)[number]["id"];

/** Every Library source the page plays, for the server to resolve. */
export function stageSources(): string[] {
  return [
    ...new Set([
      ...STAGE_STOPS.flatMap((stop) => stop.clips.map(({ spec }) => spec)),
      CREATOR_SCENE,
      ...CREATOR_PARTICLES.map(({ spec }) => spec),
    ]),
  ];
}
