import type { TrackedEmotion } from "@/lib/emotion";

import type { AmbientMood } from "./ambient";
import type { LandingKey, LandingT } from "./i18n";
import type { SocialIconName } from "./social-icons";

/*
 * The landing page's camera stops. Each stop frames the Avatar for
 * one feature; scrolling moves the camera between consecutive stops. Camera
 * values are relative to the Avatar's rest head height, so another VRM keeps
 * the same framing. The server (`../landing-stage.mjs`) reads this module to
 * resolve the Library sources the page plays. The page's words are in the
 * catalogs (`locales/<tag>.json`), keyed by these stops' and Avatars' ids.
 */

/**
 * An Included Avatar the visitor can switch to, with its starter Anima. Its
 * pronouns, IDENTITY.md excerpts, memory-demo replies and notebook lines are
 * the catalogs' `avatars.<id>`.
 */
export type StageAvatar = {
  /** Included VRM file name, without `.vrm`. */
  id: string;
  /** The starter Anima's name, used in the demos (as in the app, unchanged in every locale). */
  name: string;
  /** Portrait file in `content/included/appearances/avatar-portraits`. */
  portrait: string;
};

/**
 * The notes the memory demo shows: the owner's PROFILE.md (facts about the
 * user, shared by every Anima, which chat can update), the Anima's
 * IDENTITY.md (who it is and how it talks; chat never edits it) and its
 * MEMORIES.md (the relationship, which it keeps itself while chatting).
 */
export type MemoryNote = "profile" | "identity" | "memories";

/** The Avatars the stage offers; the first loads with the page. */
export const STAGE_AVATARS: StageAvatar[] = [
  {
    id: "Annie",
    name: "Annie",
    portrait: "app-avatar-model-annie-v1.webp",
  },
  {
    id: "Andrew",
    name: "Andrew",
    portrait: "app-avatar-model-andrew-v1.webp",
  },
];

/**
 * Fill a caption's tokens for an Avatar: `{name}`, and the pronouns
 * `{subject}`, `{object}` and `{possessive}` (the catalog's
 * `avatars.<id>.pronouns`), capitalised when the token is (`{Subject}`).
 * A locale uses whichever tokens read naturally: Japanese and Korean name
 * the Anima where English uses a pronoun.
 */
export function voice(text: string, avatar: StageAvatar, t: LandingT): string {
  return text.replace(
    /\{(name|subject|object|possessive)\}/gi,
    (_match, token: string) => {
      const key = token.toLowerCase();
      const word =
        key === "name"
          ? avatar.name
          : t(`avatars.${avatar.id}.pronouns.${key}` as LandingKey);
      return token[0] === token[0].toUpperCase()
        ? word[0].toUpperCase() + word.slice(1)
        : word;
    },
  );
}

/**
 * Width-to-height ratio below which a viewport is tall (a phone held
 * upright) and stops use their `tall` framing.
 */
export const TALL_ASPECT = 0.8;

/**
 * Where the camera stands for a stop, in head heights (the rest height of
 * the head bone). `aim` uses the Avatar on stage, so the camera finds its
 * face and body; `distance` and `rise` use the first Avatar, so a taller one
 * is framed higher rather than from further away and shows at the same size.
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

/**
 * A Gesture or Reaction a stop plays. Its chip's label is the feeling's name
 * from the app's `emotion` catalog for a Reaction, else the landing
 * catalog's `clips.<stem>`.
 */
export type StageClip = {
  /** Library spec of the clip. */
  spec: string;
  /** The Included item's name, the end of its spec. */
  stem: string;
  /** The feeling a Reaction shows. */
  feeling?: TrackedEmotion;
  /** Emotion mascot shown on the chip (`public/emotions/<file>`). */
  mascot?: string;
  /**
   * Made-up emotional state (0–30 per emotion) the demo shows while the clip
   * plays; unlisted emotions are 0.
   */
  emotion?: Partial<Record<TrackedEmotion, number>>;
};

/** The interactive demo a stop shows beside its caption. */
export type StagePanel = "mascots" | "chips" | "memory";

/** A stop's copy field; see `stopCopy`. */
type StopField = "label" | "title" | "body";

/**
 * A stop. Its words are the catalog's `stops.<id>`: `label`, the short name
 * the progress thread shows while it is active; `title` and `body`, its
 * caption's heading and one supporting line; and `links`, the body's words
 * that scroll to other stops.
 */
export type StageStop = {
  id: string;
  /**
   * The stop's colour, used by the hero's link to it: a deeper shade of an
   * app pastel, so it reads as text on the light backdrops.
   */
  accent: string;
  /**
   * Ids of the stops the body links to, in its stop's accent; each locale's
   * `stops.<id>.links.<stop>` is the word, which must appear in its body.
   */
  links?: string[];
  /** Wide (desktop) framing, and overrides for tall (phone) viewports. */
  camera: StageCamera;
  tall?: Partial<StageCamera>;
  /**
   * Framing while the hero entrance plays: wider than `camera` (waist up, so
   * her walk shows); the camera pushes in to `camera` as the title appears.
   */
  introCamera?: Partial<StageCamera>;
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
  /**
   * Clips for particular Avatars (by `StageAvatar` id) in place of `clips`,
   * so each Anima shows its own behaviors.
   */
  avatarClips?: Record<string, StageClip[]>;
  clipMode: "once" | "cycle";
  panel?: StagePanel;
  /** Fields shown from `stops.<id>.beta` while `CLOSED_BETA` is on. */
  beta?: StopField[];
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

/**
 * A Reaction chip, labelled with its feeling ("Joy"): its mascot and made-up
 * emotional state.
 */
const reaction = (stem: string, feeling: TrackedEmotion): StageClip => ({
  spec: `library:included/${stem}`,
  stem,
  feeling,
  mascot: `${feeling}-very.webp`,
  emotion: FEELINGS[feeling],
});
const gesture = (stem: string): StageClip => ({
  spec: `library:included/${stem}`,
  stem,
});

/**
 * Whether Animama is in closed beta. The page then asks visitors to request
 * access through `BETA_ACCESS_URL` instead of offering downloads and
 * accounts: the header shows one Request Beta Access button in place of
 * Download, Log in and Sign up, and stops use their `beta` copy. Turn off at
 * launch.
 */
export const CLOSED_BETA = false;
/**
 * The closed beta's request form: the Google Form's plain responder link,
 * never a pre-filled one (its `entry.…` values would be published).
 */
export const BETA_ACCESS_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeM2X7m2QsKbthbqLziO7B8r9vL0C6_zfMk4a_r_ws3hQWCYg/viewform";

/**
 * The public site: its address, and what search results and link previews
 * show. The title (`site.title`) and description (the hero's line and the
 * last stop's) are the English catalog's; search engines and link previews
 * read the English page.
 */
export const SITE = {
  url: "https://animama.ai/",
  docsUrl: "https://docs.animama.ai/",
  /** A 1200×630 still of the hero, in the page's `static/` folder. */
  shareImage: "og-image.jpg",
  shareImageAlt:
    "Annie, an Animama companion, under the words Meet your Anima.",
  /**
   * Matches the repository's LICENSE and the desktop app's copyright, so it
   * stays English in every locale.
   */
  copyright: "© 2026 Raymond Van. All rights reserved.",
  /** Third-party notices, written by the production build. */
  notices: "/notices.txt",
  /**
   * Pages Animama Cloud publishes beside this page on the same host (its
   * `apps/landing-web`); the development server does not serve them.
   */
  about: "/about/",
  download: "/download",
  privacy: "/privacy/",
  terms: "/terms/",
  safety: "/safety/",
  /**
   * Animama Cloud's account pages, where the header's Log in and Sign up go.
   * A sign-in without a `returnTo` continues into the hosted app.
   */
  signIn: "https://auth.animama.ai/sign-in",
  signUp: "https://auth.animama.ai/sign-up",
  /** The public contact address, forwarded by the domain's email routing. */
  contactEmail: "ray@animama.ai",
  /**
   * Animama's places on other sites: the footer shows them as icons (by
   * `icon`, see `social-icons.tsx`), and the page's schema.org data lists
   * them as the organization's profiles (`sameAs`).
   */
  social: [
    {
      label: "Discord",
      href: "https://discord.gg/pUHHRrZ2xg",
      icon: "discord",
    },
    {
      label: "YouTube",
      href: "https://www.youtube.com/@raymond-van",
      icon: "youtube",
    },
    {
      label: "X",
      href: "https://x.com/raymondvan_",
      icon: "x",
    },
  ] satisfies { label: string; href: string; icon: SocialIconName }[],
};

/**
 * The footer's text links (labelled by the catalog's `footer.<key>`), shared
 * by the overlay and the prerendered page text; the social links follow
 * them as icons.
 */
export const FOOTER_LINKS = [
  { key: "about", href: SITE.about },
  { key: "privacy", href: SITE.privacy },
  { key: "terms", href: SITE.terms },
  { key: "safety", href: SITE.safety },
  { key: "contact", href: `mailto:${SITE.contactEmail}` },
  { key: "notices", href: SITE.notices },
] as const;

/**
 * A stop's words for an Avatar in the active locale (`stops.<id>`), with
 * its `beta` copy while `CLOSED_BETA` is on.
 */
export function stopCopy(stop: StageStop, avatar: StageAvatar, t: LandingT) {
  const field = (name: StopField) =>
    voice(
      t(
        (CLOSED_BETA && stop.beta?.includes(name)
          ? `stops.${stop.id}.beta.${name}`
          : `stops.${stop.id}.${name}`) as LandingKey,
      ),
      avatar,
      t,
    );
  return {
    label: field("label"),
    title: field("title"),
    body: field("body"),
    links: (stop.links ?? []).map((target) => ({
      word: t(`stops.${stop.id}.links.${target}` as LandingKey),
      stop: target,
    })),
  };
}

export const STAGE_STOPS: StageStop[] = [
  {
    id: "hero",
    accent: "#8b7cf6",
    followCursor: true,
    links: ["gestures", "emotion", "memory"],
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
    introCamera: { distance: 1.4, aim: 0.9, lift: 0 },
    backdrop: HERO,
    ink: "dark",
    // The stage plays the first unless `?wave=small` picks the second.
    clips: [gesture("wave-hello"), gesture("small-shy-wave")],
    clipMode: "once",
  },
  {
    id: "gestures",
    accent: "#2f9fd0",
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
      gesture("lean-in-coy"),
      gesture("soul-leaves-body"),
      gesture("flustered-fan"),
      gesture("innocent-whistle"),
      gesture("finger-heart-pose"),
      gesture("double-peace-pop"),
      gesture("dramatic-swoon"),
      gesture("snicker-laugh"),
    ],
    avatarClips: {
      Andrew: [
        gesture("offer-a-rose"),
        gesture("air-guitar"),
        gesture("beckon"),
        gesture("brush-off-shoulders"),
        gesture("lean-in-coy"),
        gesture("ohohoho-noble-laugh"),
        gesture("nervous-head-scratch"),
      ],
    },
    clipMode: "cycle",
    panel: "chips",
  },
  {
    id: "emotion",
    accent: "#e8557c",
    followCursor: true,
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
    id: "download",
    accent: "#8b7cf6",
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
    clips: [gesture("goodbye-wave")],
    clipMode: "once",
    beta: ["label", "body"],
  },
];

/** The clips a stop plays for an Avatar: its own set, else the stop's. */
export function stopClips(stop: StageStop, avatarId: string): StageClip[] {
  return stop.avatarClips?.[avatarId] ?? stop.clips;
}

/**
 * The hero entrance's scratch walk: its upper-body clip (in `clips/`; head
 * scratch, double take and turn, played over the procedural walk) and
 * the Library items whose Avatar Effects it borrows (`question_mark`;
 * `startle_ticks`).
 */
export const PUZZLE_CLIP_FILE = "landing-walk-scratch-take.clip.json";
export const PUZZLE_EFFECT_SOURCES = [
  "library:included/thinking-head-scratch",
  "library:included/embarrassment-3-b",
];

/** Every Library source the page plays, for the server to resolve. */
export function stageSources(): string[] {
  return [
    ...new Set([
      ...STAGE_STOPS.flatMap((stop) =>
        [stop.clips, ...Object.values(stop.avatarClips ?? {})].flatMap(
          (clips) => clips.map(({ spec }) => spec),
        ),
      ),
      ...PUZZLE_EFFECT_SOURCES,
    ]),
  ];
}
