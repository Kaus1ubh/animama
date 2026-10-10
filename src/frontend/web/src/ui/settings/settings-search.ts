/** Searchable text for one setting shown in a sectioned settings modal. */
export type SettingsSearchEntry<Section extends string> = {
  section: Section;
  label: string;
  group?: string;
  description?: string;
  keywords?: readonly string[];
};

/** Split a free-text query into lowercase tokens; an empty result means "no filter". */
export function tokenizeSettingsQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * Match when every query token appears somewhere in the entry's section label,
 * group, label, description or keywords, so "tts stream" finds
 * "Stream chunked TTS" regardless of word order. The section label defaults to
 * the section ID and is the displayed (possibly translated) name otherwise.
 */
export function matchesSettingsQuery<Section extends string>(
  entry: SettingsSearchEntry<Section>,
  tokens: readonly string[],
  sectionLabel: string = entry.section,
): boolean {
  if (tokens.length === 0) return true;
  const haystack = [
    sectionLabel,
    entry.group,
    entry.label,
    entry.description,
    ...(entry.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** One selectable dropdown row: a section header or a setting inside it. */
export type SettingsSearchOption<
  Section extends string,
  Entry extends SettingsSearchEntry<Section>,
> =
  | { kind: "section"; key: string; section: Section }
  | { kind: "entry"; key: string; section: Section; entry: Entry };

/**
 * Build dropdown rows across every section in navigation order. A section
 * appears when its name or any of its settings match; its header always
 * precedes its matching settings.
 */
export function buildSettingsSearchOptions<
  Section extends string,
  Entry extends SettingsSearchEntry<Section> & { id: string },
>(
  entries: readonly Entry[],
  sections: readonly Section[],
  tokens: readonly string[],
  sectionLabel: (section: Section) => string = (section) => section,
): SettingsSearchOption<Section, Entry>[] {
  if (tokens.length === 0) return [];
  const options: SettingsSearchOption<Section, Entry>[] = [];
  for (const section of sections) {
    const label = sectionLabel(section);
    const matches = entries.filter(
      (entry) =>
        entry.section === section && matchesSettingsQuery(entry, tokens, label),
    );
    const sectionMatches = matchesSettingsQuery(
      { section, label },
      tokens,
      label,
    );
    if (matches.length === 0 && !sectionMatches) continue;
    options.push({ kind: "section", key: `section:${section}`, section });
    for (const entry of matches) {
      options.push({ kind: "entry", key: `entry:${entry.id}`, section, entry });
    }
  }
  return options;
}

/** Split text into plain and matched runs so the UI can highlight query tokens. */
export function splitHighlightedText(
  text: string,
  tokens: readonly string[],
): Array<{ text: string; match: boolean }> {
  if (tokens.length === 0) return [{ text, match: false }];
  // Longest first so "tts" doesn't pre-empt a longer overlapping token.
  const pattern = [...tokens]
    .sort((a, b) => b.length - a.length)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return text
    .split(new RegExp(`(${pattern})`, "gi"))
    .filter(Boolean)
    .map((part) => ({
      text: part,
      match: tokens.includes(part.toLowerCase()),
    }));
}

/**
 * Sections that contain at least one available entry, in navigation order.
 * Empty sections are left out of navigation and search instead of showing a
 * blank page.
 */
export function availableSettingsSections<Section extends string>(
  sections: readonly Section[],
  entries: readonly { section: Section }[],
): Section[] {
  return sections.filter((section) =>
    entries.some((entry) => entry.section === section),
  );
}
