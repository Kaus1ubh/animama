import { describe, expect, it, vi } from "vitest";

import type { PyMemoryEntryResponse } from "@/lib/content/catalogTypes";
import {
  createMemoryEntryDraft,
  discardMemoryEntryDraft,
  isMemoryEntryDraftDirty,
  saveMemoryEntryDraftsSequentially,
  syncMemoryEntryDraft,
  updateMemoryEntryDraft,
} from "./workspace-drafts";

function entry(
  id: string,
  version: number,
  content: string,
): PyMemoryEntryResponse {
  return {
    id,
    scope: "user",
    type: "file",
    name: `${id}.md`,
    path: `${id}.md`,
    version,
    content,
    description: "description",
    metadata: {},
  };
}

describe("memory workspace drafts", () => {
  it("tracks content and description changes against a baseline", () => {
    const draft = createMemoryEntryDraft(entry("one", 1, "saved"));
    expect(isMemoryEntryDraftDirty(draft)).toBe(false);
    expect(
      isMemoryEntryDraftDirty(
        updateMemoryEntryDraft(draft, { content: "draft" }),
      ),
    ).toBe(true);
    expect(
      isMemoryEntryDraftDirty(
        updateMemoryEntryDraft(draft, { description: "changed" }),
      ),
    ).toBe(true);
  });

  it("resynchronizes clean drafts when the server advances", () => {
    const draft = createMemoryEntryDraft(entry("one", 1, "old"));
    const synced = syncMemoryEntryDraft(draft, entry("one", 2, "new"));

    expect(synced.baseVersion).toBe(2);
    expect(synced.content).toBe("new");
    expect(synced.conflict).toBe(false);
  });

  it("preserves dirty content and marks a version conflict", () => {
    const draft = updateMemoryEntryDraft(
      createMemoryEntryDraft(entry("one", 1, "old")),
      { content: "my draft" },
    );
    const synced = syncMemoryEntryDraft(draft, entry("one", 2, "server"));

    expect(synced.content).toBe("my draft");
    expect(synced.baseVersion).toBe(1);
    expect(synced.conflict).toBe(true);
  });

  it("discards to the latest server value", () => {
    const discarded = discardMemoryEntryDraft(entry("one", 3, "latest"));
    expect(discarded.content).toBe("latest");
    expect(discarded.baseVersion).toBe(3);
    expect(isMemoryEntryDraftDirty(discarded)).toBe(false);
  });

  it("retains both guards when another definition edit conflicts with a dirty identity", () => {
    const identity = {
      ...entry("identity", 3, "saved"),
      aggregate_revision: 7,
    };
    const draft = updateMemoryEntryDraft(createMemoryEntryDraft(identity), {
      content: "my identity edit",
    });
    // Equipping an Avatar changes the aggregate, not the identity version.
    const synced = syncMemoryEntryDraft(draft, {
      ...identity,
      aggregate_revision: 8,
    });

    expect(synced.baseVersion).toBe(3);
    expect(synced.baseAggregateRevision).toBe(7);
    expect(synced.content).toBe("my identity edit");
    expect(synced.conflict).toBe(true);
  });

  it("rebases a clean identity draft after a name or loadout change", () => {
    const identity = {
      ...entry("identity", 3, "saved"),
      aggregate_revision: 7,
    };
    const synced = syncMemoryEntryDraft(createMemoryEntryDraft(identity), {
      ...identity,
      aggregate_revision: 8,
    });

    expect(synced.baseVersion).toBe(3);
    expect(synced.baseAggregateRevision).toBe(8);
    expect(synced.content).toBe("saved");
    expect(synced.conflict).toBe(false);
  });

  it("guards MEMORIES.md by version only, including a blank draft", () => {
    const memories: PyMemoryEntryResponse = {
      ...entry("memories", 2, "saved"),
      scope: "anima",
      anima_id: "annie",
      name: "MEMORIES.md",
      path: "MEMORIES.md",
      kind: "anima_memories",
      aggregate_revision: null,
    };
    const blank = updateMemoryEntryDraft(createMemoryEntryDraft(memories), {
      content: "",
    });

    expect(blank).not.toHaveProperty("baseAggregateRevision");
    expect(isMemoryEntryDraftDirty(blank)).toBe(true);
    expect(syncMemoryEntryDraft(blank, memories)).toBe(blank);
    expect(
      syncMemoryEntryDraft(blank, { ...memories, version: 3 }).conflict,
    ).toBe(true);
  });

  it("saves dirty drafts sequentially and stops after a failure", async () => {
    const one = updateMemoryEntryDraft(
      createMemoryEntryDraft(entry("one", 1, "saved")),
      { content: "one draft" },
    );
    const two = updateMemoryEntryDraft(
      createMemoryEntryDraft(entry("two", 1, "saved")),
      { content: "two draft" },
    );
    const three = updateMemoryEntryDraft(
      createMemoryEntryDraft(entry("three", 1, "saved")),
      { content: "three draft" },
    );
    const save = vi.fn(async (draft: typeof one) => {
      if (draft.entryId === "two") throw new Error("conflict");
    });

    await expect(
      saveMemoryEntryDraftsSequentially({ one, two, three }, save),
    ).rejects.toThrow("conflict");
    expect(save.mock.calls.map(([draft]) => draft.entryId)).toEqual([
      "one",
      "two",
    ]);
  });
});
