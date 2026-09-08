import { describe, expect, it } from "vitest";

import type { PyMemoryEntryHeader } from "@/lib/content/catalogTypes";
import { groupEpisodeEntries } from "./episode-groups";

function entry(
  id: string,
  path: string,
  overrides: Partial<PyMemoryEntryHeader> = {},
): PyMemoryEntryHeader {
  return {
    id,
    parent_id: null,
    scope: "user",
    type: "file",
    name: path.split("/").at(-1) ?? path,
    path,
    version: 1,
    metadata: {},
    ...overrides,
  };
}

describe("episode groups", () => {
  it("orders canonical episodes by month and retains legacy entries", () => {
    const groups = groupEpisodeEntries(
      [
        entry("july-9", "episodes/2026/07/2026-07-09.md", {
          kind: "episode_log",
        }),
        entry("august", "episodes/2026/08/2026-08-01.md", {
          kind: "episode_log",
        }),
        entry("july-10", "episodes/2026/07/2026-07-10.md", {
          kind: "episode_log",
        }),
        entry("legacy", "episodes/legacy.md", {
          kind: "episode_log",
          updated_at: "2026-07-11T12:00:00Z",
        }),
        entry("profile", "profile.md"),
      ],
      "",
      "en-US",
    );

    expect(groups.map((group) => group.label)).toEqual([
      "August 2026",
      "July 2026",
      "Other episodes",
    ]);
    expect(groups[1]?.items.map((item) => item.dateKey)).toEqual([
      "2026-07-10",
      "2026-07-09",
    ]);
    expect(groups[1]?.items[0]?.displayName).toBe("July 10, 2026");
    expect(groups[2]?.items[0]?.entry.id).toBe("legacy");
  });

  it("matches friendly dates and complete paths", () => {
    const entries = [
      entry("day", "episodes/2026/07/2026-07-10.md", {
        kind: "episode_log",
      }),
    ];

    expect(groupEpisodeEntries(entries, "July 10", "en-US")).toHaveLength(1);
    expect(
      groupEpisodeEntries(entries, "episodes/2026/07", "en-US"),
    ).toHaveLength(1);
    expect(groupEpisodeEntries(entries, "August", "en-US")).toEqual([]);
  });
});
