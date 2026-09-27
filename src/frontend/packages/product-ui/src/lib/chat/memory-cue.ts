import type {
  PyMemoryCue,
  PyMemoryCueEpisode,
  PyMemoryCueMemories,
} from "@animama/runtime-contracts/api-types";

/**
 * What one turn remembered (spec R6): the `remember` note recorded as an
 * episode and/or the turn's change to the Anima's `MEMORIES.md`.
 */
export type ChatMemoryCue = PyMemoryCue;

/**
 * `memory.updated`: sent at most once per turn, after the reply and before
 * `run.completed`. The cue is kept `unknown` until {@link parseMemoryCue}
 * validates it, so a malformed frame is dropped rather than misread.
 */
export type ChatMemoryUpdated = {
  type: "memory.updated";
  run_id?: string | null;
  /** The saved reply's `PyChatMessage.id`. */
  message_id?: number | null;
  memory_cue?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * Classifies by `type` only. The frame has no top-level `text`, `error`,
 * `emotions` or `gesture`, but the stream checks this guard before any
 * shape-based guard so a memory frame can never be read as another event.
 */
export function isChatMemoryUpdated(
  value: unknown,
): value is ChatMemoryUpdated {
  return isRecord(value) && value.type === "memory.updated";
}

function parseEpisode(value: unknown): PyMemoryCueEpisode | null {
  if (!isRecord(value) || typeof value.text !== "string") return null;
  return value.text.trim() ? { text: value.text } : null;
}

function parseMemories(value: unknown): PyMemoryCueMemories | null {
  if (
    !isRecord(value) ||
    typeof value.entry_id !== "string" ||
    !value.entry_id.trim() ||
    typeof value.version !== "number" ||
    !Number.isInteger(value.version) ||
    typeof value.excerpt !== "string"
  ) {
    return null;
  }
  // An empty excerpt is still a MEMORIES.md update (text was only removed).
  return {
    entry_id: value.entry_id,
    version: value.version,
    excerpt: value.excerpt,
  };
}

/**
 * Returns a cue with at least one valid part, or `null` when the value is
 * missing, empty or malformed. Used for both the stream event and history rows.
 */
export function parseMemoryCue(value: unknown): ChatMemoryCue | null {
  if (!isRecord(value)) return null;
  const episode = parseEpisode(value.episode);
  const memories = parseMemories(value.memories);
  return episode || memories ? { episode, memories } : null;
}
