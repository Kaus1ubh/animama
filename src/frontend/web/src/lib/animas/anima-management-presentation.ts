import {
  buildEmotionRuntimeState,
  formatTrackedEmotionLabel,
  normalizeEmotionStateMap,
} from "@/lib/emotion";

const PERSONALITY_HEADING = /^#{1,6}\s+personality\b/i;
const MARKDOWN_HEADING = /^#{1,6}\s+/;

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^>\s?/, "")
    .replace(/[`*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) return value;
  const candidate = value.slice(0, Math.max(1, maximumLength - 1)).trimEnd();
  const lastSpace = candidate.lastIndexOf(" ");
  const truncated =
    lastSpace > maximumLength * 0.6 ? candidate.slice(0, lastSpace) : candidate;
  return `${truncated.trimEnd()}…`;
}

/** Prefer the scoped memory document while retaining the Avatar seed fallback. */
export function resolveAnimaIdentityContent(
  memoryIdentity: string | null | undefined,
  seedIdentity: string | null | undefined,
): string {
  return memoryIdentity?.trim() || seedIdentity?.trim() || "";
}

/**
 * Extract concise prose from identity Markdown, preferring the Personality
 * section while avoiding raw Markdown syntax in the roster summary.
 */
export function summarizeIdentityMarkdown(
  source: string | null | undefined,
  maximumLength = 180,
): string {
  const lines = (source ?? "").split(/\r?\n/);
  const personalityIndex = lines.findIndex((line) =>
    PERSONALITY_HEADING.test(line.trim()),
  );
  const personalityLines =
    personalityIndex >= 0 ? lines.slice(personalityIndex + 1) : [];
  const nextHeadingIndex = personalityLines.findIndex((line) =>
    MARKDOWN_HEADING.test(line.trim()),
  );
  const candidateLines =
    personalityIndex < 0
      ? lines
      : nextHeadingIndex < 0
        ? personalityLines
        : personalityLines.slice(0, nextHeadingIndex);
  const summary = candidateLines
    .map((line) => line.trim())
    .filter((line) => line && !MARKDOWN_HEADING.test(line))
    .map(stripInlineMarkdown)
    .filter(Boolean)
    .join(" ");

  return summary ? truncateAtWord(summary, maximumLength) : "";
}

/** Render the strongest persisted emotion as one compact, human label. */
export function getAnimaMoodLabel(emotionalState: unknown): string {
  const runtimeState = buildEmotionRuntimeState(
    normalizeEmotionStateMap(emotionalState),
  );
  const primaryEmotion =
    runtimeState.dominantGroupSummary?.primaryEmotion?.emotion;
  return primaryEmotion ? formatTrackedEmotionLabel(primaryEmotion) : "Neutral";
}
