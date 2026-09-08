import { describe, expect, it, vi } from "vitest";
import { buildAnimaSpec } from "./createAnimaDraft";
import {
  defaultAnimaIdentityMarkdown,
  DEFAULT_ANIMA_IDENTITY_MARKDOWN,
  PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN,
} from "./createAnimaIdentity";
import {
  CreateAnimaDraftStorage,
  CreationDraftConflict,
  creationStorageKey,
  migrateCreationRecord,
} from "./createAnimaDraftStorage";
import { readyDraft } from "./createAnimaTestFixtures";

function legacyRecord(options: { image?: boolean; locked?: boolean } = {}) {
  const current = readyDraft();
  const request = {
    ...buildAnimaSpec(current),
    display_name: options.locked ? "x".repeat(80) : "Rowan",
    idempotency_key: "legacy-frozen",
  };
  return {
    schema_version: 1,
    writer: "00000000-0000-4000-8000-000000000001",
    sequence: 7,
    kind: "draft",
    draft: {
      ...current,
      schema_version: 1,
      identity_markdown: "",
      appearance: {
        profile: options.image
          ? {
              source: {
                item_id: "portrait",
                revision_sha256: "a".repeat(64),
              },
              presentation: {
                fit: "cover",
                focal_x: 0.5,
                focal_y: 0.5,
                zoom: 1,
              },
            }
          : null,
        background: null,
      },
      profile_mode: options.image ? "custom" : "none",
      portrait_avatar: null,
      portrait_pending: false,
      needs_image_reselection: false,
      submission: options.locked ? { request, state: "pending" } : null,
      appearance_migration: undefined,
    },
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
  };
}

describe("owner-scoped creation recovery", () => {
  it("migrates safe v1 drafts and seeds only a blank identity", () => {
    const record = migrateCreationRecord(JSON.stringify(legacyRecord()));
    expect(record).toMatchObject({
      schema_version: 2,
      kind: "draft",
      draft: {
        schema_version: 2,
        appearance_migration: "none",
        identity_markdown: defaultAnimaIdentityMarkdown("  Rowan 🌿  "),
      },
    });
  });

  it("adds the current name only to a generated heading in an editable draft", () => {
    const editable = readyDraft();
    editable.identity_markdown = PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN;
    editable.submission = null;
    const record = migrateCreationRecord(
      JSON.stringify({
        schema_version: 2,
        writer: "00000000-0000-4000-8000-000000000001",
        sequence: 8,
        kind: "draft",
        draft: editable,
      }),
    );
    expect(record).toMatchObject({
      kind: "draft",
      draft: {
        identity_markdown: defaultAnimaIdentityMarkdown(editable.display_name),
      },
    });

    editable.identity_markdown = `${DEFAULT_ANIMA_IDENTITY_MARKDOWN}\nCustom`;
    const expectedCustomizedIdentity = `${defaultAnimaIdentityMarkdown(editable.display_name)}\nCustom`;
    const customized = migrateCreationRecord(
      JSON.stringify({
        schema_version: 2,
        writer: "00000000-0000-4000-8000-000000000001",
        sequence: 9,
        kind: "draft",
        draft: editable,
      }),
    );
    expect(customized).toMatchObject({
      kind: "draft",
      draft: { identity_markdown: expectedCustomizedIdentity },
    });

    editable.identity_markdown = `# Captain Rowan\n${PREVIOUS_DEFAULT_ANIMA_IDENTITY_MARKDOWN}`;
    const customHeading = migrateCreationRecord(
      JSON.stringify({
        schema_version: 2,
        writer: "00000000-0000-4000-8000-000000000001",
        sequence: 10,
        kind: "draft",
        draft: editable,
      }),
    );
    expect(customHeading).toMatchObject({
      kind: "draft",
      draft: { identity_markdown: editable.identity_markdown },
    });
  });

  it("requires confirmation for v1 image choices but never rewrites a frozen request", () => {
    const editable = migrateCreationRecord(
      JSON.stringify(legacyRecord({ image: true })),
    );
    expect(editable).toMatchObject({
      kind: "draft",
      draft: { appearance_migration: "confirmation_required" },
    });

    const raw = JSON.stringify(legacyRecord({ image: true, locked: true }));
    const frozen = migrateCreationRecord(raw);
    expect(frozen).toMatchObject({
      kind: "draft",
      draft: {
        appearance_migration: "confirmation_required",
        submission: {
          state: "pending",
          request: {
            display_name: "x".repeat(80),
            idempotency_key: "legacy-frozen",
          },
        },
      },
    });
  });
  it("isolates owners and installations and restores a strict draft", () => {
    const storage = memoryStorage();
    const key = creationStorageKey("owner-a", "http://localhost:5173");
    const first = new CreateAnimaDraftStorage(key, storage);
    first.read();
    first.save(readyDraft());
    const second = new CreateAnimaDraftStorage(key, storage);
    expect(second.read()).toMatchObject({
      kind: "draft",
      draft: { display_name: "  Rowan 🌿  " },
    });
    expect(
      new CreateAnimaDraftStorage(
        creationStorageKey("owner-b", "http://localhost:5173"),
        storage,
      ).read(),
    ).toBeNull();
    expect(
      new CreateAnimaDraftStorage(
        creationStorageKey("owner-a", "http://localhost:8322"),
        storage,
      ).read(),
    ).toBeNull();
  });

  it.each([
    "not-json",
    '{"schema_version":99}',
    '{"schema_version":1,"kind":"draft"}',
  ])("preserves unreadable records until explicit discard: %s", (raw) => {
    const storage = memoryStorage();
    storage.setItem("draft", raw);
    const store = new CreateAnimaDraftStorage("draft", storage);
    expect(() => store.read()).toThrow();
    expect(() => store.discard()).toThrow();
    expect(storage.getItem("draft")).toBe(raw);
    store.discard({ corruptConfirmed: true });
    expect(storage.getItem("draft")).toBeNull();
  });

  it("detects competing writes before save and requires an explicit editable takeover", () => {
    const storage = memoryStorage();
    const first = new CreateAnimaDraftStorage("draft", storage);
    const second = new CreateAnimaDraftStorage("draft", storage);
    first.read();
    second.read();
    first.save(readyDraft());
    expect(second.changedElsewhere()).toBe(true);
    expect(() => second.save(readyDraft())).toThrow(CreationDraftConflict);
    second.takeOver();
    expect(first.changedElsewhere()).toBe(true);
  });

  it.each(["pending", "unknown", "conflict", "deleted"] as const)(
    "never discards or takes over a %s command",
    (state) => {
      const storage = memoryStorage();
      const store = new CreateAnimaDraftStorage("draft", storage);
      const draft = readyDraft();
      store.save({
        ...draft,
        submission: {
          state,
          request: { ...buildAnimaSpec(draft), idempotency_key: "frozen" },
        },
      });
      expect(() => store.discard()).toThrow("Check creation result");
      expect(() => store.takeOver()).toThrow("pending");
      expect(storage.getItem("draft")).toContain('"idempotency_key":"frozen"');
      if (state === "deleted") {
        store.discard({ acknowledgeDeleted: true });
        expect(storage.getItem("draft")).toBeNull();
      }
    },
  );

  it("keeps only the existing result ID after authoritative success", () => {
    const storage = memoryStorage();
    const store = new CreateAnimaDraftStorage("draft", storage);
    store.save(readyDraft());
    store.complete("anima-created");
    const raw = storage.getItem("draft")!;
    expect(migrateCreationRecord(raw)).toMatchObject({
      kind: "complete",
      anima_id: "anima-created",
    });
    expect(raw).not.toContain("identity_markdown");
    expect(raw).not.toContain("avatar");
    expect(() => store.complete("https://external.test/result")).toThrow();
  });

  it("surfaces denied storage without deleting recovery state or writing partial values", () => {
    const storage = memoryStorage();
    const store = new CreateAnimaDraftStorage("draft", storage);
    store.save(readyDraft());
    const prior = storage.getItem("draft");
    storage.setItem.mockImplementation(() => {
      throw new DOMException("Quota", "QuotaExceededError");
    });
    expect(() => store.save(readyDraft())).toThrow("Quota");
    expect(storage.getItem("draft")).toBe(prior);
    expect(storage.removeItem).not.toHaveBeenCalled();
  });
});
