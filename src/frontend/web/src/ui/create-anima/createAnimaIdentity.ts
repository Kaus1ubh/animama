/** Previous untouched seed body, recognized only for a safe editable-draft upgrade. */
export const PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN = [
  "## Personality",
  "Describe their temperament and how they respond to people.",
  "## Speaking style",
  "Describe their tone, word choice, and pace.",
  "## Values",
  "Describe what matters to them.",
  "## Background",
  "Describe the experiences that shape them.",
  "## Boundaries",
  "Describe what they avoid and how they express limits.",
].join("\n");

/** Section hints of the current `IDENTITY.md` template; the owner replaces each hint. */
const DEFAULT_ANIMA_IDENTITY_BODY = [
  ["Essence", "In a sentence or two, who they are at heart."],
  [
    "Personality",
    "Temperament, quirks, and how they react to people and situations.",
  ],
  [
    "Speaking style",
    "Tone, word choice, pace, humor and verbal habits. Replies are often spoken aloud.",
  ],
  [
    "Appearance and presence",
    "How they look, dress and carry themselves; how they move and express emotion.",
  ],
  ["Background", "The history and experiences that shape them."],
  ["Interests", "What they love, know about and enjoy talking about."],
  ["Values", "What matters to them and what they stand for."],
  [
    "With the user",
    "The role they play in the user's life (friend, sidekick, mentor…) and how they show care, give support and disagree.",
  ],
  [
    "Boundaries",
    "Topics they avoid, lines they will not cross and how they express limits.",
  ],
]
  .map(([heading, hint]) => `## ${heading}\n${hint}`)
  .join("\n\n");

const identityNameHeading = (displayName: string) =>
  `# ${displayName.trim() || "[NAME]"}`;

const firstLineOf = (value: string) =>
  /^(.*?)(?:\r?\n|$)/.exec(value)?.[1] ?? value;

/** Build the editable starter document with its current display name. */
export function defaultAnimaIdentityMarkdown(displayName = ""): string {
  return `${identityNameHeading(displayName)}\n\n${DEFAULT_ANIMA_IDENTITY_BODY}`;
}

/** Editable starter content before a brand-new Anima has been named. */
export const DEFAULT_ANIMA_IDENTITY_MARKDOWN = defaultAnimaIdentityMarkdown();

/** Keep only the generated heading synchronized; preserve customized headings. */
export function synchronizeDefaultAnimaIdentityName(
  value: string,
  previousDisplayName: string,
  nextDisplayName: string,
): string {
  const firstLine = firstLineOf(value);
  if (
    firstLine !== identityNameHeading(previousDisplayName) &&
    firstLine !== identityNameHeading("")
  )
    return value;
  return `${identityNameHeading(nextDisplayName)}${value.slice(firstLine.length)}`;
}

/**
 * Replace an untouched previous template body with the current one, keeping any
 * heading; otherwise only synchronize a generated heading. Edited bodies are
 * never rewritten.
 */
export function upgradeDefaultAnimaIdentityMarkdown(
  value: string,
  displayName = "",
): string {
  const firstLine = firstLineOf(value);
  const hasHeading = firstLine.startsWith("# ");
  const body = hasHeading
    ? value.slice(firstLine.length).replace(/^\r?\n/, "")
    : value;
  if (body === PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN) {
    const heading = hasHeading ? firstLine : identityNameHeading("");
    return synchronizeDefaultAnimaIdentityName(
      `${heading}\n\n${DEFAULT_ANIMA_IDENTITY_BODY}`,
      "",
      displayName,
    );
  }
  return synchronizeDefaultAnimaIdentityName(value, "", displayName);
}
