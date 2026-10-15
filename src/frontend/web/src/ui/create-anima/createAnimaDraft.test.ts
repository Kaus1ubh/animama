import { describe, expect, it } from "vitest";
import {
  addReactionPoolMember,
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
  reactionMemberCount,
  reconcileCreationIssues,
  removeReactionPoolMember,
  samePool,
  setReactionPool,
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

  it.each([false, true])(
    "reads retired clip evidence only from saved drafts and frozen requests (voice field: %s)",
    (hasVoice) => {
      const draft = readyDraft();
      const { voice, ...spec } = buildAnimaSpec(draft);
      const legacyEvidence = {
        old_clip: {
          kind: "pose_clip" as const,
          revision_sha256: "a".repeat(64),
        },
      };
      const request = {
        ...spec,
        ...(hasVoice ? { voice } : {}),
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
          evidence: {
            avatar: { source: ref("avatar"), revisions: legacyEvidence },
          },
        }),
      ).toThrow();
    },
  );

  it("constructs schema v4 with the exact editable identity seed and 96 empty pools", () => {
    const draft = newCreateAnimaDraft();
    expect(draft.schema_version).toBe(4);
    expect(draft.identity_markdown).toBe(DEFAULT_ANIMA_IDENTITY_MARKDOWN);
    expect(draft.identity_markdown).toBe(
      [
        "# [NAME]",
        "",
        "## Essence",
        "In a sentence or two, who they are at heart.",
        "",
        "## Personality",
        "Temperament, quirks, and how they react to people and situations.",
        "",
        "## Speaking style",
        "Tone, word choice, pace, humor and verbal habits. Replies are often spoken aloud.",
        "",
        "## Appearance and presence",
        "How they look, dress and carry themselves; how they move and express emotion.",
        "",
        "## Background",
        "The history and experiences that shape them.",
        "",
        "## Interests",
        "What they love, know about and enjoy talking about.",
        "",
        "## Values",
        "What matters to them and what they stand for.",
        "",
        "## With the user",
        "The role they play in the user's life (friend, sidekick, mentor…) and how they show care, give support and disagree.",
        "",
        "## Boundaries",
        "Topics they avoid, lines they will not cross and how they express limits.",
      ].join("\n"),
    );
    expect(draft.meaningful).toBe(false);
    expect(draft.appearance_migration).toBe("none");
    const pools = Object.values(draft.reactions).flatMap(Object.values);
    expect(pools).toHaveLength(96);
    expect(pools.every((pool) => pool.length === 0)).toBe(true);
  });

  it("keeps the generated identity heading synchronized with the display name", () => {
    const named = createAnimaDraftReducer(newCreateAnimaDraft(), {
      type: "edit",
      patch: { display_name: "  Rowan  " },
    });
    expect(named.identity_markdown).toMatch(/^# Rowan\n\n## Essence/);

    const renamed = createAnimaDraftReducer(named, {
      type: "edit",
      patch: { display_name: "Juniper" },
    });
    expect(renamed.identity_markdown).toMatch(/^# Juniper\n\n## Essence/);

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
      /^# Captain Juniper\n\n## Essence/,
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
    draft.reactions = setReactionPool(draft, "joy", "3", [ref("reaction")]);
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

  it("accepts empty pools and a Reaction in several cells and pools", () => {
    const draft = readyDraft();
    expect(draftIssues(draft, 3)).toEqual([]);
    expect(reactionCount(draft)).toBe(0);
    draft.reactions = setReactionPool(draft, "anger", "1", [ref("reaction")]);
    draft.reactions = setReactionPool(draft, "joy", "4", [
      ref("other"),
      ref("reaction"),
    ]);
    // Cells holding at least one Reaction.
    expect(reactionCount(draft)).toBe(2);
    expect(creationRoots(draft).map((item) => item.path)).toEqual(
      expect.arrayContaining([
        "/reactions/anger/1/0",
        "/reactions/joy/4/0",
        "/reactions/joy/4/1",
      ]),
    );
    expect(samePool(draft.reactions.joy["4"], [ref("other")])).toBe(false);
    expect(
      samePool(draft.reactions.joy["4"], [ref("other"), ref("reaction")]),
    ).toBe(true);
    // Members are drawn at random, so their order does not matter.
    expect(
      samePool(draft.reactions.joy["4"], [ref("reaction"), ref("other")]),
    ).toBe(true);
    expect(
      samePool(draft.reactions.joy["4"], [ref("reaction", "c"), ref("other")]),
    ).toBe(false);
  });

  it("adds and removes pool members, refusing a repeat or a fifth", () => {
    const draft = readyDraft();
    let reactions = addReactionPoolMember(draft, "joy", "2", ref("a"));
    reactions = addReactionPoolMember({ reactions }, "joy", "2", ref("b"));
    expect(reactions.joy["2"]).toEqual([ref("a"), ref("b")]);
    // Another revision of a member is still that Reaction.
    expect(
      addReactionPoolMember({ reactions }, "joy", "2", ref("a", "c")),
    ).toBe(reactions);
    reactions = addReactionPoolMember({ reactions }, "joy", "2", ref("c"));
    reactions = addReactionPoolMember({ reactions }, "joy", "2", ref("d"));
    expect(addReactionPoolMember({ reactions }, "joy", "2", ref("e"))).toBe(
      reactions,
    );
    // A Reaction may join several cells; other cells are untouched.
    const elsewhere = addReactionPoolMember(
      { reactions },
      "joy",
      "3",
      ref("a"),
    );
    expect(elsewhere.joy["3"]).toEqual([ref("a")]);
    expect(elsewhere.joy["2"]).toBe(reactions.joy["2"]);

    const removed = removeReactionPoolMember({ reactions }, "joy", "2", "b");
    expect(removed.joy["2"]).toEqual([ref("a"), ref("c"), ref("d")]);
    expect(reactionCount({ reactions: removed })).toBe(1);
    // A Reaction counts once for each cell it is in.
    expect(reactionMemberCount({ reactions: elsewhere })).toBe(5);
  });

  it("submits each of the 96 cells' pools exactly", () => {
    const draft = readyDraft();
    draft.reactions = addReactionPoolMember(draft, "joy", "4", ref("cheer"));
    draft.reactions = addReactionPoolMember(draft, "joy", "4", ref("grin"));
    draft.reactions = addReactionPoolMember(draft, "anger", "1", ref("grin"));
    draft.evidence = {
      ...draft.evidence,
      cheer: {
        source: ref("cheer"),
        revisions: { cheer: revision("reaction") },
      },
      grin: { source: ref("grin"), revisions: { grin: revision("reaction") } },
    };
    const spec = buildAnimaSpec(draft);
    const pools = Object.values(spec.reactions).flatMap((cells) =>
      Object.values(cells),
    );
    expect(pools).toHaveLength(96);
    expect(spec.reactions.joy["4"]).toEqual([ref("cheer"), ref("grin")]);
    expect(spec.reactions.anger["1"]).toEqual([ref("grin")]);
    expect(pools.filter((pool) => pool.length)).toHaveLength(2);
  });

  it("rejects a fifth Reaction or a repeated one in a cell", () => {
    const draft = readyDraft();
    const withPool = (pool: ReturnType<typeof ref>[]) =>
      createAnimaDraftSchema.safeParse({
        ...draft,
        reactions: setReactionPool(draft, "joy", "2", pool),
      }).success;
    expect(withPool(["a", "b", "c", "d"].map((id) => ref(id)))).toBe(true);
    expect(withPool(["a", "b", "c", "d", "e"].map((id) => ref(id)))).toBe(
      false,
    );
    expect(withPool([ref("a"), ref("a", "c")])).toBe(false);
  });

  it("leaves the Idle pool to the server", () => {
    const draft = readyDraft();
    expect(draft).not.toHaveProperty("default_idle");
    const spec = buildAnimaSpec(draft);
    expect(spec).not.toHaveProperty("idle");
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
    expect(issueStep("/identity_markdown")).toBe(2);
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
      path: "/reactions/joy/1/0",
      item_id: "reaction",
      declaring_action_item_id: "reaction",
    };
    const after = { ...before, display_name: "Fixed" };
    expect(reconcileCreationIssues([local, source], before, after)).toEqual([
      source,
    ]);
  });

  it("freezes only complete selected roots", () => {
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
    ).toEqual(["avatar"]);
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
