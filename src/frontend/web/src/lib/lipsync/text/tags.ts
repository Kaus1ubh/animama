/**
 * Vocal tags in spoken text: Gemini writes them in angle brackets (`<laugh>`,
 * `<long pause>`), ElevenLabs in square brackets (`[laughs]`,
 * `[whispering, playful]`). Each becomes a lip-sync tag kind. The grammar and
 * classification are product-ui's audio tags, shared with chat bubbles, the
 * speech text and the provider timing evidence, so they all agree on what a tag
 * is and what kind it is. (The timing evidence accepts any short bracketed
 * span, so it can see a tag the shared grammar rejects; both classify a tag's
 * directions the same way.)
 */

import {
  classifyAudioTag,
  findAudioTags,
  stripAudioTags,
} from "@animama/product-ui/audio-tags";
import type { LipSyncTagKind } from "./units";

export type ParsedTag = {
  /** The tag as written, brackets included. */
  label: string;
  start: number;
  end: number;
  /** The strongest direction's kind; see `lipSyncTagKind`. */
  kind: LipSyncTagKind;
  /** Every direction's kind, for combined tags such as `[laughs, whispering]`. */
  kinds: LipSyncTagKind[];
};

export type TextPiece =
  | { type: "text"; start: number; end: number }
  | { type: "tag"; tag: ParsedTag };

const LAUGH = /\b(laugh\w*|chuckl\w*|giggl\w*)\b/;
const SIGH = /\b(sigh\w*|exhal\w*|breath\w*|inhal\w*)\b/;
const GASP = /\bgasp\w*\b/;
const WHISPER = /\bwhisper\w*\b/;

/** Expected length of each tag kind that takes time, in seconds. */
export const TAG_PRIOR_SEC: Partial<Record<LipSyncTagKind, number>> = {
  laugh: 0.9,
  sigh: 0.8,
  gasp: 0.4,
  vocal: 0.6,
  pause: 0.6,
  sound_effect: 0.8,
};

/** The prior for a pause tag: short, long or plain. */
export function pausePriorSec(label: string): number {
  if (/long/i.test(label)) return 1;
  if (/short/i.test(label)) return 0.35;
  return TAG_PRIOR_SEC.pause!;
}

/** The lip-sync kind of one direction, such as `laughs softly` or `long pause`. */
function directionKind(direction: string): LipSyncTagKind {
  const lower = direction.toLowerCase();
  switch (classifyAudioTag(direction)) {
    case "sound_effect":
      return "sound_effect";
    case "pacing":
      return "pause";
    case "nonverbal":
      if (LAUGH.test(lower)) return "laugh";
      if (GASP.test(lower)) return "gasp";
      if (SIGH.test(lower)) return "sigh";
      return "vocal";
    default:
      return WHISPER.test(lower) ? "whisper" : "delivery";
  }
}

// When directions combine, the one that most changes the mouth wins.
const KIND_STRENGTH: LipSyncTagKind[] = [
  "sound_effect",
  "laugh",
  "gasp",
  "sigh",
  "vocal",
  "pause",
  "whisper",
  "delivery",
];

/** The kind of each comma-separated direction in a tag's text. */
function directionKinds(content: string): LipSyncTagKind[] {
  return content
    .split(",")
    .map((direction) => direction.trim())
    .filter(Boolean)
    .map(directionKind);
}

/** The lip-sync kind of a tag's text, without brackets: its strongest direction. */
export function lipSyncTagKind(content: string): LipSyncTagKind {
  const kinds = directionKinds(content);
  return KIND_STRENGTH.find((kind) => kinds.includes(kind)) ?? "delivery";
}

/** Split text into text pieces and tags, keeping source ranges. */
export function splitTags(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let last = 0;
  for (const { label, content, start, end } of findAudioTags(text)) {
    if (start > last) pieces.push({ type: "text", start: last, end: start });
    pieces.push({
      type: "tag",
      tag: {
        label,
        start,
        end,
        kind: lipSyncTagKind(content),
        kinds: directionKinds(content),
      },
    });
    last = end;
  }
  if (last < text.length)
    pieces.push({ type: "text", start: last, end: text.length });
  return pieces;
}

/** Text with its tags removed, for consumers that speak or show it without them. */
export const stripTags = stripAudioTags;
