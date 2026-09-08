/** Previous untouched seed, recognized only for a safe editable-draft upgrade. */
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

const identityNameHeading = (displayName: string) =>
  `# ${displayName.trim() || "[NAME]"}`;

/** Build the editable starter document with its current display name. */
export function defaultAnimaIdentityMarkdown(displayName = ""): string {
  return [
    identityNameHeading(displayName),
    PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN,
  ].join("\n");
}

/** Editable starter content before a brand-new Anima has been named. */
export const DEFAULT_ANIMA_IDENTITY_MARKDOWN = defaultAnimaIdentityMarkdown();

/** Keep only the generated heading synchronized; preserve customized headings. */
export function synchronizeDefaultAnimaIdentityName(
  value: string,
  previousDisplayName: string,
  nextDisplayName: string,
): string {
  const firstLine = /^(.*?)(?:\r?\n|$)/.exec(value)?.[1] ?? value;
  if (
    firstLine !== identityNameHeading(previousDisplayName) &&
    firstLine !== identityNameHeading("")
  )
    return value;
  return `${identityNameHeading(nextDisplayName)}${value.slice(firstLine.length)}`;
}

/** Upgrade untouched or placeholder-bearing editable documents without losing edits. */
export function upgradeDefaultAnimaIdentityMarkdown(
  value: string,
  displayName = "",
): string {
  if (value === PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN)
    return defaultAnimaIdentityMarkdown(displayName);
  return synchronizeDefaultAnimaIdentityName(value, "", displayName);
}
