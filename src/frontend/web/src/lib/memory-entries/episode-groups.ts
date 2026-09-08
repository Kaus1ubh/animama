import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { isEpisodeLogEntry } from "@/lib/memory-entries/protection";

const CANONICAL_EPISODE_PATH =
  /^episodes\/(\d{4})\/(\d{2})\/(\d{4})-(\d{2})-(\d{2})\.md$/;

export type EpisodeListItem = {
  entry: PyMemoryEntryHeader;
  dateKey: string | null;
  displayName: string;
};

export type EpisodeGroup = {
  key: string;
  label: string;
  items: EpisodeListItem[];
};

function parseEpisodeDate(path: string) {
  const match = CANONICAL_EPISODE_PATH.exec(path);
  if (!match) return null;

  const [, folderYear, folderMonth, fileYear, fileMonth, fileDay] = match;
  if (folderYear !== fileYear || folderMonth !== fileMonth) return null;

  const year = Number(fileYear);
  const month = Number(fileMonth);
  const day = Number(fileDay);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    date,
    dateKey: `${fileYear}-${fileMonth}-${fileDay}`,
    monthKey: `${fileYear}-${fileMonth}`,
  };
}

function updatedAtTime(entry: PyMemoryEntryHeader) {
  if (!entry.updated_at) return 0;
  const time = new Date(entry.updated_at).getTime();
  return Number.isNaN(time) ? 0 : time;
}

/** Groups generated episode files chronologically while retaining legacy paths. */
export function groupEpisodeEntries(
  entries: PyMemoryEntryHeader[],
  query = "",
  locale?: string,
): EpisodeGroup[] {
  const dateFormatter = new Intl.DateTimeFormat(locale, {
    dateStyle: "long",
    timeZone: "UTC",
  });
  const monthFormatter = new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const needle = query.trim().toLocaleLowerCase(locale);
  const dated: Array<
    EpisodeListItem & { date: Date; monthKey: string; monthLabel: string }
  > = [];
  const legacy: EpisodeListItem[] = [];

  for (const entry of entries) {
    if (entry.type !== "file" || !isEpisodeLogEntry(entry)) continue;
    const parsed = parseEpisodeDate(entry.path);
    const displayName = parsed ? dateFormatter.format(parsed.date) : entry.name;
    const searchable =
      `${displayName} ${entry.name} ${entry.path}`.toLocaleLowerCase(locale);
    if (needle && !searchable.includes(needle)) continue;

    if (parsed) {
      dated.push({
        entry,
        date: parsed.date,
        dateKey: parsed.dateKey,
        displayName,
        monthKey: parsed.monthKey,
        monthLabel: monthFormatter.format(parsed.date),
      });
    } else {
      legacy.push({ entry, dateKey: null, displayName });
    }
  }

  dated.sort(
    (left, right) =>
      right.date.getTime() - left.date.getTime() ||
      left.entry.path.localeCompare(right.entry.path),
  );
  legacy.sort(
    (left, right) =>
      updatedAtTime(right.entry) - updatedAtTime(left.entry) ||
      left.entry.path.localeCompare(right.entry.path),
  );

  const groups: EpisodeGroup[] = [];
  for (const item of dated) {
    let group = groups.at(-1);
    if (group?.key !== item.monthKey) {
      group = { key: item.monthKey, label: item.monthLabel, items: [] };
      groups.push(group);
    }
    group.items.push({
      entry: item.entry,
      dateKey: item.dateKey,
      displayName: item.displayName,
    });
  }
  if (legacy.length > 0) {
    groups.push({ key: "other", label: "Other episodes", items: legacy });
  }
  return groups;
}
