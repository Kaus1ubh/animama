import type { TrackedEmotion } from "@/lib/emotion";

import type { AmbientMood } from "./ambient";

/*
 * The landing page's camera stops. Each stop frames the Avatar for
 * one feature; scrolling moves the camera between consecutive stops. Camera
 * values are relative to the Avatar's rest head height, so another VRM keeps
 * the same framing. The server (`../landing-stage.mjs`) reads this module to
 * resolve the Library sources the page plays.
 */

/** An Included Avatar the visitor can switch to, with its starter Anima. */
export type StageAvatar = {
  /** Included VRM file name, without `.vrm`. */
  id: string;
  /** The starter Anima's name, used in the demos. */
  name: string;
  /** Portrait file in `content/included/appearances/avatar-portraits`. */
  portrait: string;
  /** The pronouns captions use for this Anima (see `voice`). */
  pronouns: { subject: string; object: string; possessive: string };
  /** IDENTITY.md excerpts for the memory demo, from the starter identity. */
  identity: { heading: string; line: string }[];
  /**
   * The memory demo's chat for each note: a visitor's line and this Anima's
   * reply, in its own voice.
   */
  memoryChats: Record<MemoryNote, { user: string; reply: string }>;
  /** What each memory notebook page is for, in this Anima's own voice. */
  notebook: { purpose: Record<MemoryNote, string> };
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
    id: "AvatarSample_A_1_New",
    name: "Annie",
    portrait: "app-avatar-model-avatarsample-a-1-new-v1.webp",
    pronouns: { subject: "she", object: "her", possessive: "her" },
    identity: [
      {
        heading: "Essence",
        line: "A warm, curious companion who helps you think out loud and turn vague ideas into clear next steps.",
      },
      {
        heading: "Speaking style",
        line: "Short, natural sentences. She reflects back what she heard before offering ideas, with gentle humor.",
      },
      {
        heading: "Interests",
        line: "Journaling, cozy cafés and whatever you're excited about.",
      },
    ],
    memoryChats: {
      profile: {
        user: "We adopted a kitten today! Her name is Miso.",
        reply:
          "Miso! Welcome to the family, little one. Tell me everything about her first week.",
      },
      identity: {
        user: "Everything is due this week and I don't know where to start.",
        reply:
          "So it all landed at once. Let's make it smaller. What's due first?",
      },
      memories: {
        user: "I'll tell you how the recital goes on Friday!",
        reply: "Deal. Friday, full report. I'll be the first to ask.",
      },
    },
    notebook: {
      purpose: {
        profile:
          "Things you've told me about you. Every Anima shares this page, and you can edit it too.",
        identity:
          "Who I am and how I talk. You can rewrite this page any time. I never change it myself.",
        memories:
          "Our moments: promises, in-jokes, little milestones. I write this page as we chat.",
      },
    },
  },
  {
    id: "Andrew",
    name: "Andrew",
    portrait: "app-avatar-model-andrew-v1.webp",
    pronouns: { subject: "he", object: "him", possessive: "his" },
    identity: [
      {
        heading: "Essence",
        line: "A friendly, easygoing university student who likes figuring things out together.",
      },
      {
        heading: "Speaking style",
        line: "Casual and clear, thinks out loud, asks good follow-ups, with a quick self-deprecating joke.",
      },
      {
        heading: "Interests",
        line: "Making playlists, games, new places to eat and odd facts picked up from lectures.",
      },
    ],
    memoryChats: {
      profile: {
        user: "We adopted a kitten today! Her name is Miso.",
        reply:
          "No way, Miso! Great name. Okay, I need everything. What does she look like?",
      },
      identity: {
        user: "Everything is due this week and I don't know where to start.",
        reply:
          "Ugh, I know that feeling. Let's list it all out, then pick the smallest thing first?",
      },
      memories: {
        user: "I'll tell you how the recital goes on Friday!",
        reply: "You'd better! Friday, full story. I'll be rooting for you.",
      },
    },
    notebook: {
      purpose: {
        profile:
          "Stuff you've told me about you. Every Anima shares this page, and you can edit it too.",
        identity:
          "Who I am and how I talk. You can rewrite this page any time; I won't.",
        memories:
          "Our story so far: plans, inside jokes, big days. I jot it down as we talk.",
      },
    },
  },
];

/**
 * Fill a caption's tokens for an Avatar: `{name}`, and the pronouns
 * `{subject}`, `{object}` and `{possessive}`, capitalised when the token is
 * (`{Subject}`).
 */
export function voice(text: string, avatar: StageAvatar): string {
  return text.replace(
    /\{(name|subject|object|possessive)\}/gi,
    (_match, token: string) => {
      const key = token.toLowerCase();
      const word =
        key === "name"
          ? avatar.name
          : avatar.pronouns[key as keyof StageAvatar["pronouns"]];
      return token[0] === token[0].toUpperCase()
        ? word[0].toUpperCase() + word.slice(1)
        : word;
    },
  );
}

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
export type StagePanel = "mascots" | "chips" | "memory";

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
  /** Copy shown in its place while `CLOSED_BETA` is on. */
  beta?: Partial<Pick<StageStop, "label" | "title" | "body">>;
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
const reaction = (stem: string, feeling: TrackedEmotion): StageClip => {
  const name = feeling.charAt(0).toUpperCase() + feeling.slice(1);
  return {
    label: name,
    spec: `library:included/${stem}`,
    mascot: `${feeling}-very.webp`,
    emotion: FEELINGS[feeling],
  };
};
const gesture = (stem: string, label: string): StageClip => ({
  label,
  spec: `library:included/${stem}`,
});

/**
 * Whether Animama is in closed beta. The page then asks visitors to request
 * access through `BETA_ACCESS_URL` instead of offering downloads and
 * accounts: the header shows one Request Beta Access button in place of
 * Download, Log in and Sign up, and stops use their `beta` copy. Turn off at
 * launch.
 */
export const CLOSED_BETA = true;
/**
 * The closed beta's request form: the Google Form's plain responder link,
 * never a pre-filled one (its `entry.…` values would be published).
 */
export const BETA_ACCESS_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSeM2X7m2QsKbthbqLziO7B8r9vL0C6_zfMk4a_r_ws3hQWCYg/viewform";

/**
 * The public site: its address, and what search results and link previews
 * show (the description joins the hero's line and the last stop's).
 */
export const SITE = {
  url: "https://animama.ai/",
  docsUrl: "https://docs.animama.ai/",
  title: "Animama — AI companions that feel alive",
  /** A 1200×630 still of the hero, in the page's `static/` folder. */
  shareImage: "og-image.jpg",
  shareImageAlt:
    "Annie, an Animama companion, under the words Meet your Anima.",
  /** Matches the repository's LICENSE and the desktop app's copyright. */
  copyright: "© 2026 Raymond Van. All rights reserved.",
  /** What the 3D stage shows, for screen readers (it is hidden from them). */
  sceneDescription:
    "{name}, an animated 3D Anima, walks in and waves, then shows {possessive} gestures, emotions and memories as you scroll.",
  /** Third-party notices, written by the production build. */
  notices: "/notices.txt",
  /**
   * Pages Animama Cloud publishes beside this page on the same host (its
   * `apps/landing-web`); the development server does not serve them.
   */
  about: "/about/",
  privacy: "/privacy/",
  terms: "/terms/",
  /** The public contact address, forwarded by the domain's email routing. */
  contactEmail: "ray@animama.ai",
  /**
   * Animama's places on other sites: the footer links them, and the page's
   * schema.org data lists them as the organization's profiles (`sameAs`).
   */
  social: [
    { label: "Discord", href: "https://discord.gg/pUHHRrZ2xg" },
    { label: "YouTube", href: "https://www.youtube.com/@rayplusplus" },
  ],
};

/** The footer's links, shared by the overlay and the prerendered page text. */
export const FOOTER_LINKS = [
  { label: "About", href: SITE.about },
  { label: "Privacy", href: SITE.privacy },
  { label: "Terms", href: SITE.terms },
  { label: "Contact", href: `mailto:${SITE.contactEmail}` },
  ...SITE.social,
  { label: "Docs", href: SITE.docsUrl },
  { label: "Third-party notices", href: SITE.notices },
];

/** Stops with their `beta` copy applied while `CLOSED_BETA` is on. */
function withBetaCopy(stops: StageStop[]): StageStop[] {
  return CLOSED_BETA
    ? stops.map((stop) => (stop.beta ? { ...stop, ...stop.beta } : stop))
    : stops;
}

export const STAGE_STOPS: StageStop[] = withBetaCopy([
  {
    id: "hero",
    accent: "#8b7cf6",
    label: "Intro",
    followCursor: true,
    title: "Meet your Anima",
    body: "AI companions that feel alive with their own behaviors, emotions and memories.",
    links: [
      { word: "behaviors", stop: "gestures" },
      { word: "emotions", stop: "emotion" },
      { word: "memories", stop: "memory" },
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
    introCamera: { distance: 1.4, aim: 0.9, lift: 0 },
    backdrop: HERO,
    ink: "dark",
    // The stage plays the first unless `?wave=small` picks the second.
    clips: [
      gesture("wave-hello", "Wave hello"),
      gesture("small-shy-wave", "Small wave"),
    ],
    clipMode: "once",
  },
  {
    id: "gestures",
    accent: "#2f9fd0",
    label: "Behaviors",
    title: "Body Language",
    body: "From laughing at your jokes to romantic gestures: **over 300 unique gestures and reactions**, picked as {subject} talks.",
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
      gesture("lean-in-coy", "Coy"),
      gesture("soul-leaves-body", "Soulless"),
      gesture("flustered-fan", "Flustered fan"),
      gesture("innocent-whistle", "Innocent whistle"),
      gesture("finger-heart-pose", "Finger heart"),
      gesture("double-peace-pop", "Double peace"),
      gesture("dramatic-swoon", "Dramatic swoon"),
      gesture("snicker-laugh", "Snicker"),
    ],
    avatarClips: {
      Andrew: [
        gesture("offer-a-rose", "Rose"),
        gesture("air-guitar", "Air guitar"),
        gesture("beckon", "Beckon"),
        gesture("brush-off-shoulders", "Brush shoulders"),
        gesture("lean-in-coy", "Coy"),
        gesture("ohohoho-noble-laugh", "Noble laugh"),
        gesture("nervous-head-scratch", "Head scratch"),
      ],
    },
    clipMode: "cycle",
    panel: "chips",
  },
  {
    id: "emotion",
    accent: "#e8557c",
    label: "Emotions",
    followCursor: true,
    title: "{Possessive} heart on {possessive} sleeve",
    body: "24 emotions that shift and evolve during your time together.",
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
    label: "Memories",
    title: "{Subject} remembers the little things",
    body: "Your cat's name, Friday's recital: {subject} follows up so you don't have to.",
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
    label: "Download",
    title: "Meet {object} on your desktop",
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
    beta: {
      label: "Beta",
      body: "Now in closed beta for macOS and Windows.",
    },
  },
]);

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
