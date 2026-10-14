/**
 * Audio tags in the chat model's speech: their grammar, classes and provider text.
 *
 * The chat model may write short bracketed directions in `speech`, such as
 * `[laughs]` or `<long pause>`. Gemini performs a small set of them in angle
 * brackets, ElevenLabs performs free-form directions in square brackets, and
 * every other reader (chat bubbles, browser speech, Pocket TTS) needs them
 * removed. This module is the browser half of one grammar; the backend's
 * `animama.domain.audio_tags` is the other. Both run
 * `tests/fixtures/audio-tag-cases.json`, so they agree on every case.
 */

/**
 * What a tag direction does to the audio:
 * - `nonverbal`: a vocal sound such as a laugh, sigh or gasp;
 * - `sound_effect`: a non-speech sound such as applause or a door;
 * - `pacing`: a pause;
 * - `delivery`: an emotion or delivery direction for the words after it.
 *   Unknown directions are delivery.
 */
export type AudioTagClass =
  | "nonverbal"
  | "sound_effect"
  | "pacing"
  | "delivery";

/** The voices that perform audio tags. */
export type SpeechTagProvider = "gemini" | "elevenlabs";

/**
 * At most this many sounds (non-verbal sounds, sound effects and pauses) reach
 * a voice per reply; emotion and delivery directions are not capped.
 */
export const SPEECH_SOUND_CAP = 2;

/** A direction with a word starting with this asks for an accent, which no voice gets. */
export const AUDIO_TAG_ACCENT_PREFIX = "accent";

/** A tag the model may write for any tag-capable voice, and each voice's spelling. */
export type NeutralAudioTag = {
  id: string;
  aliases: string[];
  gemini: string;
  elevenlabs: string;
  sound: boolean;
};

export const NEUTRAL_AUDIO_TAGS: readonly NeutralAudioTag[] = [
  {
    id: "laugh",
    aliases: ["laugh", "laughs", "laughing", "laughter"],
    gemini: "<laugh>",
    elevenlabs: "[laughs]",
    sound: true,
  },
  {
    id: "chuckle",
    aliases: ["chuckle", "chuckles", "chuckling"],
    gemini: "<chuckle>",
    elevenlabs: "[chuckles]",
    sound: true,
  },
  {
    id: "giggle",
    aliases: ["giggle", "giggles", "giggling"],
    gemini: "<giggle>",
    elevenlabs: "[giggles]",
    sound: true,
  },
  {
    id: "sigh",
    aliases: ["sigh", "sighs", "sighing"],
    gemini: "<sigh>",
    elevenlabs: "[sighs]",
    sound: true,
  },
  {
    id: "gasp",
    aliases: ["gasp", "gasps", "gasping"],
    gemini: "<gasp>",
    elevenlabs: "[gasps]",
    sound: true,
  },
  {
    id: "breath",
    aliases: ["breath", "breathes", "breathing"],
    gemini: "<breath>",
    elevenlabs: "[breathes]",
    sound: true,
  },
  {
    id: "short_pause",
    aliases: ["short pause", "pause"],
    gemini: "<short pause>",
    elevenlabs: "[pause]",
    sound: true,
  },
  {
    id: "long_pause",
    aliases: ["long pause"],
    gemini: "<long pause>",
    elevenlabs: "[long pause]",
    sound: true,
  },
  {
    id: "whisper",
    aliases: ["whisper", "whispers", "whispering"],
    gemini: "<whispers>",
    elevenlabs: "[whispers]",
    sound: false,
  },
];

/** Lowercase words that name each class; any other direction is delivery. */
export const AUDIO_TAG_WORD_CLASSES: Readonly<
  Record<Exclude<AudioTagClass, "delivery">, ReadonlySet<string>>
> = {
  sound_effect: new Set([
    "applause",
    "beep",
    "beeps",
    "bell",
    "bells",
    "clapping",
    "claps",
    "crash",
    "ding",
    "door",
    "explosion",
    "footsteps",
    "gulp",
    "gulps",
    "gunshot",
    "gunshots",
    "knock",
    "knocking",
    "knocks",
    "phone",
    "rain",
    "ringing",
    "splash",
    "swallows",
    "thunder",
    "wind",
  ]),
  nonverbal: new Set([
    "breath",
    "breathes",
    "breathing",
    "chuckle",
    "chuckles",
    "chuckling",
    "cough",
    "coughing",
    "coughs",
    "cries",
    "cry",
    "crying",
    "exhale",
    "exhales",
    "exhaling",
    "gasp",
    "gasping",
    "gasps",
    "giggle",
    "giggles",
    "giggling",
    "groan",
    "groaning",
    "groans",
    "grunt",
    "grunts",
    "hiccup",
    "hiccups",
    "hum",
    "humming",
    "hums",
    "inhale",
    "inhales",
    "inhaling",
    "laugh",
    "laughing",
    "laughs",
    "laughter",
    "scream",
    "screaming",
    "screams",
    "sigh",
    "sighing",
    "sighs",
    "sneeze",
    "sneezes",
    "sneezing",
    "sniff",
    "sniffle",
    "sniffles",
    "sniffs",
    "snicker",
    "snickers",
    "snort",
    "snorting",
    "snorts",
    "sob",
    "sobbing",
    "sobs",
    "throat",
    "wheeze",
    "wheezes",
    "wheezing",
    "whimper",
    "whimpers",
    "yawn",
    "yawning",
    "yawns",
  ]),
  pacing: new Set(["pause", "pauses", "silence"]),
};

/** When directions combine, the strongest class wins; delivery is the default. */
export const AUDIO_TAG_CLASS_STRENGTH: readonly AudioTagClass[] = [
  "sound_effect",
  "nonverbal",
  "pacing",
  "delivery",
];

// A tag is a short direction in words, starting with a letter: [laughs] or
// <long pause>, up to 64 characters. Digits or symbols ("x < 5 and y > 3") make
// it text, and a square span followed by "(" is a Markdown link label.
const AUDIO_TAG =
  /<(\p{L}[\p{L} ,.!?'’-]{0,63})>|\[(\p{L}[\p{L} ,.!?'’-]{0,63})\](?!\()/gu;
const NOT_LETTER = /[^\p{L}]+/u;
// A tag still being written: its opening bracket, then the words so far, if any.
const OPEN_TAG_CONTENT = /^(?:\p{L}[\p{L} ,.!?'’-]{0,63})?$/u;
const STRAY_BRACKET = /[[\]<>]/g;
const NEUTRAL_BY_ALIAS = new Map(
  NEUTRAL_AUDIO_TAGS.flatMap((tag) =>
    tag.aliases.map((alias) => [alias, tag] as const),
  ),
);

/** One tag found in text: as written (`label`), its inner `content` and range. */
export type AudioTagMatch = {
  label: string;
  content: string;
  start: number;
  end: number;
};

/** Every audio tag in `text`, in order. */
export function findAudioTags(text: string): AudioTagMatch[] {
  return Array.from(text.matchAll(AUDIO_TAG), (match) => ({
    label: match[0],
    content: match[1] ?? match[2]!,
    start: match.index,
    end: match.index + match[0].length,
  }));
}

/**
 * Whether `text` ends inside a tag still being written, such as
 * `Well [sighs. long`. Sentence and chunk splitters must not end a piece there,
 * or the tag's halves would be spoken as words.
 */
export function endsInsideAudioTag(text: string): boolean {
  const opener = Math.max(text.lastIndexOf("["), text.lastIndexOf("<"));
  return opener >= 0 && OPEN_TAG_CONTENT.test(text.slice(opener + 1));
}

/** The class of one direction, such as `laughs softly` or `long pause`. */
export function classifyAudioTag(direction: string): AudioTagClass {
  const words = direction.toLowerCase().split(NOT_LETTER);
  for (const tagClass of AUDIO_TAG_CLASS_STRENGTH) {
    if (tagClass === "delivery") break;
    const named = AUDIO_TAG_WORD_CLASSES[tagClass];
    if (words.some((word) => named.has(word))) return tagClass;
  }
  return "delivery";
}

/** The strongest class among a tag's comma-separated directions. */
export function audioTagClass(content: string): AudioTagClass {
  const classes = content
    .split(",")
    .map((direction) => direction.trim())
    .filter(Boolean)
    .map(classifyAudioTag);
  return (
    AUDIO_TAG_CLASS_STRENGTH.find((tagClass) => classes.includes(tagClass)) ??
    "delivery"
  );
}

function neutralAudioTag(content: string): NeutralAudioTag | undefined {
  const key = content
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ")
    .replace(/^[ .,!?]+|[ .,!?]+$/gu, "");
  return NEUTRAL_BY_ALIAS.get(key);
}

function asksForAccent(content: string): boolean {
  return content
    .toLowerCase()
    .split(NOT_LETTER)
    .some((word) => word.startsWith(AUDIO_TAG_ACCENT_PREFIX));
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .trim();
}

/** `text` without its tags, for readers that show or speak it without them. */
export function stripAudioTags(text: string): string {
  return tidy(text.replace(AUDIO_TAG, " "));
}

/**
 * Speech text as a chat bubble shows it, with its tags hidden. Text without tags
 * is returned unchanged; otherwise the spacing is tidied as in `stripAudioTags`.
 * Unlike `stripAudioTags`, it keeps the text's leading and trailing whitespace,
 * so streamed segments still join, and returns "" when only tags remain.
 */
export function hideSpeechTags(text: string): string {
  if (findAudioTags(text).length === 0) return text;
  const visible = stripAudioTags(text);
  if (!visible) return "";
  const leading = /^\s*/u.exec(text)![0];
  const trailing = /\s*$/u.exec(text)![0];
  return leading + visible + trailing;
}

/**
 * Prepares one reply's speech for a tag-capable voice, a chunk at a time.
 *
 * Accepted tags are respelled for the provider, and everything else that reads
 * as a tag is dropped, so no tag is spoken as words. Outside accepted tags no
 * bracket character remains, so nothing else becomes a provider control. The
 * sound cap counts across every chunk, so create one per reply.
 */
export function createProviderSpeechText(
  provider: SpeechTagProvider,
): (text: string) => string {
  let sounds = 0;

  const accepted = (tag: AudioTagMatch): string | null => {
    const neutral = neutralAudioTag(tag.content);
    let label: string;
    let sound: boolean;
    if (provider === "gemini") {
      if (!neutral) return null;
      label = neutral.gemini;
      sound = neutral.sound;
    } else if (asksForAccent(tag.content)) {
      return null;
    } else if (neutral) {
      label = neutral.elevenlabs;
      sound = neutral.sound;
    } else {
      label = `[${tag.content}]`;
      sound = audioTagClass(tag.content) !== "delivery";
    }
    if (sound) {
      if (sounds >= SPEECH_SOUND_CAP) return null;
      sounds += 1;
    }
    return label;
  };

  return (text) => {
    let prepared = "";
    let afterSquareTag = false;
    let last = 0;
    const appendText = (piece: string) => {
      const cleaned = piece.replace(STRAY_BRACKET, "");
      // "[sad](aside)" would read as a Markdown link label, not a tag.
      prepared +=
        afterSquareTag && cleaned.startsWith("(") ? ` ${cleaned}` : cleaned;
    };
    for (const tag of findAudioTags(text)) {
      appendText(text.slice(last, tag.start));
      const label = accepted(tag);
      prepared += label ?? " ";
      afterSquareTag = label?.startsWith("[") ?? false;
      last = tag.end;
    }
    appendText(text.slice(last));
    return tidy(prepared);
  };
}
