import { describe, expect, it } from "vitest";
import {
  buildAnimaSpec,
  createAnimaDraftReducer,
  createAnimaDraftSchema,
  creationRequestSchema,
  creationRoots,
  draftIssues,
  emptyReactions,
  identityBytes,
  issueStep,
  mergeSourceMaps,
  nameLength,
  newCreateAnimaDraft,
  reactionCount,
  reconcileCreationIssues,
  setReaction,
  sourceMapSchema,
} from "./createAnimaDraft";
import { DEFAULT_ANIMA_IDENTITY_MARKDOWN } from "./createAnimaIdentity";
import {
  creationOptions,
  readyDraft,
  ref,
  revision,
} from "./createAnimaTestFixtures";

describe("CreateAnimaDraft", () => {
  it("accepts Pose source evidence without adding a creation equipment root", () => {
    const evidence = { pose: revision("pose") };
    expect(sourceMapSchema.parse(evidence)).toEqual(evidence);
    const draft = { ...readyDraft(), seed_revisions: evidence };
    expect(createAnimaDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      creationRoots(draft).some((root) => String(root.kind) === "pose"),
    ).toBe(false);
  });

  it("reads retired clip evidence only from saved drafts and frozen requests", () => {
    const draft = readyDraft();
    const legacyEvidence = {
      old_clip: { kind: "pose_clip", revision_sha256: "a".repeat(64) },
    };
    const request = {
      ...buildAnimaSpec(draft),
      idempotency_key: "old-retry",
      expected_source_revisions: legacyEvidence,
    };
    const restored = createAnimaDraftSchema.parse({
      ...draft,
      seed_revisions: legacyEvidence,
      submission: { state: "unknown", request },
    });
    expect(restored.submission?.request).toEqual(request);
    expect(restored.seed_revisions).toEqual(legacyEvidence);
    expect(sourceMapSchema.safeParse(legacyEvidence).success).toBe(false);
    expect(creationRequestSchema.safeParse(request).success).toBe(false);
    expect(() =>
      buildAnimaSpec({
        ...draft,
        idle_revisions: legacyEvidence,
      } as typeof draft),
    ).toThrow();
  });

  it("constructs schema v2 with the exact editable identity seed and 72 null cells", () => {
    const draft = newCreateAnimaDraft();
    expect(draft.schema_version).toBe(2);
    expect(draft.identity_markdown).toBe(DEFAULT_ANIMA_IDENTITY_MARKDOWN);
    expect(draft.identity_markdown).toBe(
      "# [NAME]\n## Personality\nDescribe their temperament and how they respond to people.\n## Speaking style\nDescribe their tone, word choice, and pace.\n## Values\nDescribe what matters to them.\n## Background\nDescribe the experiences that shape them.\n## Boundaries\nDescribe what they avoid and how they express limits.",
    );
    expect(draft.meaningful).toBe(false);
    expect(draft.appearance_migration).toBe("none");
    expect(Object.values(draft.reactions).flatMap(Object.values)).toHaveLength(
      72,
    );
  });

  it("keeps the generated identity heading synchronized with the display name", () => {
    const named = createAnimaDraftReducer(newCreateAnimaDraft(), {
      type: "edit",
      patch: { display_name: "  Rowan  " },
    });
    expect(named.identity_markdown).toMatch(/^# Rowan\n## Personality/);

    const renamed = createAnimaDraftReducer(named, {
      type: "edit",
      patch: { display_name: "Juniper" },
    });
    expect(renamed.identity_markdown).toMatch(/^# Juniper\n## Personality/);

    const customized = createAnimaDraftReducer(renamed, {
      type: "edit",
      patch: {
        identity_markdown: renamed.identity_markdown.replace(
          "# Juniper",
          "# Captain Juniper",
        ),
      },
    });
    const renamedAgain = createAnimaDraftReducer(customized, {
      type: "edit",
      patch: { display_name: "Pine" },
    });
    expect(renamedAgain.identity_markdown).toMatch(
      /^# Captain Juniper\n## Personality/,
    );
  });

  it("seeds the Starter Pack once and an explicit reset preserves Avatar and identity", () => {
    const options = creationOptions();
    options.recommended.gestures = [
      { semantic_key: "greeting", source: ref("wave") },
    ];
    const seeded = createAnimaDraftReducer(newCreateAnimaDraft(), {
      type: "seed",
      options,
    });
    const edited = createAnimaDraftReducer(seeded, {
      type: "edit",
      patch: { gestures: [] },
    });
    expect(createAnimaDraftReducer(edited, { type: "seed", options })).toBe(
      edited,
    );
    const ready = readyDraft();
    const reset = createAnimaDraftReducer(ready, {
      type: "reset-actions",
      options,
    });
    expect(reset.identity_markdown).toBe(ready.identity_markdown);
    expect(reset.avatar).toEqual(ready.avatar);
  });

  it("never silently seeds an incomplete Recommended Starter Pack", () => {
    const options = creationOptions();
    options.diagnostics = [
      {
        code: "recommended_source_unavailable",
        message: "Missing Gesture",
        path: "/recommended/gestures",
      },
    ];
    const initial = newCreateAnimaDraft();
    expect(createAnimaDraftReducer(initial, { type: "seed", options })).toBe(
      initial,
    );
  });

  it("changing Avatar preserves Actions and identity", () => {
    const draft = readyDraft();
    draft.reactions = setReaction(draft, "joy", "3", ref("reaction"));
    const next = createAnimaDraftReducer(draft, {
      type: "avatar",
      source: ref("next"),
      evidence: {
        source: ref("next"),
        revisions: { next: revision("avatar") },
      },
    });
    expect(next.reactions).toEqual(draft.reactions);
    expect(next.identity_markdown).toBe(draft.identity_markdown);
  });

  it("accepts empty selections and repeated Reaction assignments", () => {
    const draft = readyDraft();
    expect(draftIssues(draft, 3)).toEqual([]);
    expect(reactionCount(draft)).toBe(0);
    draft.reactions = setReaction(draft, "anger", "1", ref("reaction"));
    draft.reactions = setReaction(draft, "joy", "3", ref("reaction"));
    expect(reactionCount(draft)).toBe(2);
    expect(creationRoots(draft).map((item) => item.path)).toEqual(
      expect.arrayContaining(["/reactions/joy/3", "/reactions/anger/1"]),
    );
  });

  it("can review and submit without an optional idle style", () => {
    const draft = { ...readyDraft(), default_idle: null, idle_revisions: {} };
    expect(draftIssues(draft, 3)).toEqual([]);
    const spec = buildAnimaSpec(draft);
    expect(spec.expected_source_revisions).not.toHaveProperty("idle");
    expect(spec.avatar).toEqual(draft.avatar);
  });

  it("normalizes text and always emits explicit null Appearance", () => {
    const spec = buildAnimaSpec(readyDraft());
    expect(spec.display_name).toBe("Rowan 🌿");
    expect(spec.identity_markdown).toBe("# Rowan\n\nA curious companion.  \n");
    expect(spec.appearance).toEqual({ profile: null, background: null });
    expect(nameLength(" 🌿 ")).toBe(1);
    expect(identityBytes("é\r\n")).toBe(3);
  });

  it.each([
    { display_name: " ", path: "/display_name" },
    { display_name: "a".repeat(41), path: "/display_name" },
    { display_name: "bad\ud800", path: "/display_name" },
    { identity_markdown: " \n ", path: "/identity_markdown" },
    { identity_markdown: "é".repeat(16385), path: "/identity_markdown" },
    { identity_markdown: "bad\u0000", path: "/identity_markdown" },
  ])("rejects invalid name/identity at $path", ({ path, ...patch }) => {
    expect(
      draftIssues({ ...readyDraft(), ...patch }, 3).some(
        (issue) => issue.path === path,
      ),
    ).toBe(true);
  });

  it("counts Unicode code points and treats display-name issues as global", () => {
    expect(nameLength("🧑‍🎨")).toBe(3);
    expect(nameLength("😀".repeat(40))).toBe(40);
    expect(
      draftIssues({ ...readyDraft(), display_name: "😀".repeat(40) }, 3),
    ).toEqual([]);
    expect(
      draftIssues({ ...readyDraft(), display_name: "😀".repeat(41) }, 3),
    ).toHaveLength(1);
    expect(issueStep("/display_name")).toBeNull();
    expect(issueStep("/identity_markdown")).toBe(1);
  });

  it("uses a direct required-name message before the broader format message", () => {
    expect(
      draftIssues({ ...readyDraft(), display_name: " " }, 3)[0]?.message,
    ).toBe("Enter a name to continue.");
    expect(
      draftIssues({ ...readyDraft(), display_name: "a".repeat(41) }, 3)[0]
        ?.message,
    ).toBe("Use 1–40 characters without control characters.");
  });

  it("requires the creator-wide name before leaving the Avatar step", () => {
    expect(
      draftIssues({ ...readyDraft(), display_name: "" }, 0).map(
        (issue) => issue.path,
      ),
    ).toEqual(["/display_name"]);
  });

  it("honors smaller installation limits and only flags unsaved VRMs", () => {
    expect(
      draftIssues(readyDraft(), 3, 4).some(
        (issue) => issue.path === "/identity_markdown",
      ),
    ).toBe(true);
    const restored = createAnimaDraftSchema.parse({
      ...readyDraft(),
      needs_file_reselection: true,
    });
    expect(draftIssues(restored, 0)).toHaveLength(1);
  });

  it("retires a fixed field diagnostic without hiding an unaffected source issue", () => {
    const before = { ...readyDraft(), display_name: "" };
    const local = draftIssues(before, 3)[0]!;
    const source = {
      code: "source_needs_attention",
      message: "Review this Reaction source.",
      path: "/reactions/joy/1",
      item_id: "reaction",
      declaring_action_item_id: "reaction",
    };
    const after = { ...before, display_name: "Fixed" };
    expect(reconcileCreationIssues([local, source], before, after)).toEqual([
      source,
    ]);
  });

  it("freezes only complete selected roots and hidden Idle closure", () => {
    const draft = readyDraft();
    const extra = {
      ...draft,
      evidence: {
        ...draft.evidence,
        unused: {
          source: ref("unused"),
          revisions: { unused: revision("gesture") },
        },
      },
    };
    expect(
      Object.keys(buildAnimaSpec(extra).expected_source_revisions).sort(),
    ).toEqual(["avatar", "idle", "idle_pose"]);
    expect(() =>
      buildAnimaSpec({ ...draft, avatar: ref("avatar", "c") }),
    ).toThrow("exact source validation");
    expect(() =>
      mergeSourceMaps([
        { avatar: revision("avatar") },
        { avatar: revision("avatar", "c") },
      ]),
    ).toThrow("disagree");
  });

  it("rejects unknown fields, delivery paths, partial cells and owner metadata", () => {
    const draft = readyDraft();
    expect(
      createAnimaDraftSchema.safeParse({ ...draft, metadata: {} }).success,
    ).toBe(false);
    expect(
      createAnimaDraftSchema.safeParse({
        ...draft,
        avatar: { ...ref("avatar"), url: "https://example.test/model" },
      }).success,
    ).toBe(false);
    expect(
      createAnimaDraftSchema.safeParse({
        ...draft,
        avatar: ref("/host/file.vrm"),
      }).success,
    ).toBe(false);
    const reactions = emptyReactions();
    Reflect.deleteProperty(reactions, "joy");
    expect(
      createAnimaDraftSchema.safeParse({ ...draft, reactions }).success,
    ).toBe(false);
    expect(
      creationRequestSchema.safeParse({
        ...buildAnimaSpec(draft),
        idempotency_key: "key",
        owner_user_id: "other",
      }).success,
    ).toBe(false);
  });

  it.each(["pending", "unknown", "conflict", "deleted"] as const)(
    "locks %s input, seed and navigation",
    (state) => {
      const draft = readyDraft();
      const locked = {
        ...draft,
        submission: {
          state,
          request: { ...buildAnimaSpec(draft), idempotency_key: "original" },
        },
      };
      expect(
        createAnimaDraftReducer(locked, {
          type: "edit",
          patch: { display_name: "different" },
        }),
      ).toBe(locked);
      expect(createAnimaDraftReducer(locked, { type: "step", step: 3 })).toBe(
        locked,
      );
    },
  );
});
