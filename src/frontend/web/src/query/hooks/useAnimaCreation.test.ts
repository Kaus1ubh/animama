import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PyTypedContentPreview } from "@animama/runtime-contracts/sdk";
import {
  buildAnimaSpec,
  setReaction,
} from "@/ui/create-anima/createAnimaDraft";
import {
  readyDraft,
  ref,
  revision,
} from "@/ui/create-anima/createAnimaTestFixtures";
import {
  AnimaCreationApiError,
  creationEvidence,
  loadCreationPreview,
  resolveCreationEvidence,
} from "./useAnimaCreation";

const { preview, evidence } = vi.hoisted(() => ({
  preview: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock("@animama/runtime-contracts/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@animama/runtime-contracts/sdk")>()),
  resolveContentEvidence: evidence,
}));
vi.mock("@/lib/content/catalogApi", () => ({
  previewTypedCatalogItem: preview,
}));
const clients: QueryClient[] = [];
function client() {
  const value = new QueryClient();
  clients.push(value);
  return value;
}
afterEach(() => {
  clients.forEach((value) => value.clear());
  clients.length = 0;
  preview.mockReset();
  evidence.mockReset();
});

function evidenceResult(
  roots: Array<{
    id: string;
    kind: "avatar" | "gesture" | "reaction" | "idle_style";
    revisions: Record<string, ReturnType<typeof revision>>;
  }>,
) {
  return {
    data: {
      schema_version: 1,
      complete: true,
      roots: roots.map((root) => ({
        root_key: `catalog:${root.id}`,
        kind: root.kind,
        source: ref(root.id),
        expected_source_revisions: root.revisions,
      })),
      combined_expected_source_revisions: Object.assign(
        {},
        ...roots.map((root) => root.revisions),
      ),
      diagnostics: [],
    },
  };
}

function typed(id = "avatar", kind = "avatar", changes = {}) {
  return {
    preview_id: "preview-test",
    expires_at: "2030-01-01T00:00:00Z",
    item: { ...ref(id), kind },
    revision_sha256: ref(id).revision_sha256,
    files: [],
    expected_source_revisions: { [id]: revision(kind as "avatar") },
    ...changes,
  } as unknown as PyTypedContentPreview;
}

describe("revision-pinned creation reads", () => {
  it("does not let a StrictMode consumer abort poison shared preview metadata", async () => {
    let finish!: (value: PyTypedContentPreview) => void;
    preview.mockImplementation(
      (_kind, _id, signal: AbortSignal) =>
        new Promise((resolve, reject) => {
          finish = resolve;
          signal.addEventListener("abort", () =>
            reject(new Error("cache aborted")),
          );
        }),
    );
    const cache = client();
    const firstSignal = new AbortController();
    const first = loadCreationPreview(cache, "owner", "avatar", ref("avatar"), {
      signal: firstSignal.signal,
    });
    firstSignal.abort();
    const second = loadCreationPreview(
      cache,
      "owner",
      "avatar",
      ref("avatar"),
      { signal: new AbortController().signal },
    );
    finish(typed());
    await expect(first).resolves.toMatchObject({
      revision_sha256: ref("avatar").revision_sha256,
    });
    await expect(second).resolves.toMatchObject({
      item: { item_id: "avatar" },
    });
    expect(preview).toHaveBeenCalledTimes(1);
  });
  it("never substitutes a newer revision unless the user explicitly accepts it", async () => {
    preview.mockResolvedValue(
      typed("avatar", "avatar", {
        item: { ...ref("avatar", "b"), kind: "avatar" },
        revision_sha256: "b".repeat(64),
        expected_source_revisions: { avatar: revision("avatar", "b") },
      }),
    );
    const cache = client();
    await expect(
      loadCreationPreview(cache, "owner", "avatar", ref("avatar")),
    ).rejects.toBeInstanceOf(AnimaCreationApiError);
    await expect(
      loadCreationPreview(cache, "owner", "avatar", ref("avatar"), {
        acceptCurrent: true,
      }),
    ).resolves.toMatchObject({ revision_sha256: "b".repeat(64) });
  });
  it("keeps preview caches owner-scoped and validates complete root evidence", async () => {
    preview.mockResolvedValue(typed());
    const cache = client();
    await loadCreationPreview(cache, "owner-a", "avatar", ref("avatar"));
    await loadCreationPreview(cache, "owner-b", "avatar", ref("avatar"));
    expect(preview).toHaveBeenCalledTimes(2);
    expect(() =>
      creationEvidence(
        typed("avatar", "avatar", { expected_source_revisions: {} }),
      ),
    ).toThrow("incomplete revision evidence");
  });
  it("accepts recommended Actions whose preview closure has its own revision", async () => {
    const draft = readyDraft();
    draft.gestures = [{ semantic_key: "wave", source: ref("gesture") }];
    draft.seed_revisions = {
      ...draft.seed_revisions,
      gesture: revision("gesture"),
      support: revision("gesture"),
    };
    evidence.mockResolvedValue(
      evidenceResult([
        {
          id: "avatar",
          kind: "avatar",
          revisions: { avatar: revision("avatar") },
        },
        {
          id: "gesture",
          kind: "gesture",
          revisions: {
            gesture: revision("gesture"),
            support: revision("gesture"),
          },
        },
        {
          id: "idle",
          kind: "idle_style",
          revisions: {
            idle: revision("idle_style"),
            idle_pose: revision("gesture"),
          },
        },
      ]),
    );

    const resolved = await resolveCreationEvidence(client(), "owner", draft);

    expect(resolved.evidence.gesture).toEqual({
      source: ref("gesture"),
      revisions: {
        gesture: revision("gesture"),
        support: revision("gesture"),
      },
    });
    expect(buildAnimaSpec(resolved).expected_source_revisions).toMatchObject({
      gesture: revision("gesture"),
      support: revision("gesture"),
    });
    expect(evidence).toHaveBeenCalledTimes(1);
    expect(preview).not.toHaveBeenCalled();
  });
  it("resolves the exact union without stale unselected sources", async () => {
    evidence.mockResolvedValue(
      evidenceResult([
        {
          id: "avatar",
          kind: "avatar",
          revisions: { avatar: revision("avatar") },
        },
        {
          id: "idle",
          kind: "idle_style",
          revisions: {
            idle: revision("idle_style"),
            idle_pose: revision("gesture"),
          },
        },
      ]),
    );
    const resolved = await resolveCreationEvidence(
      client(),
      "owner",
      readyDraft(),
    );
    expect(
      Object.keys(buildAnimaSpec(resolved).expected_source_revisions).sort(),
    ).toEqual(["avatar", "idle", "idle_pose"]);
    expect(evidence.mock.calls[0]?.[0].body.roots).toHaveLength(2);
    expect(preview).not.toHaveBeenCalled();
  });
  it("preserves conflicting declarations so the batch resolver rejects them", async () => {
    const draft = readyDraft();
    draft.gestures = [{ semantic_key: "wave", source: ref("avatar") }];
    evidence.mockResolvedValue({
      data: {
        schema_version: 1,
        complete: false,
        roots: [
          {
            root_key: "catalog:idle",
            kind: "idle_style",
            source: ref("idle"),
            expected_source_revisions: {
              idle: revision("idle_style"),
              idle_pose: revision("gesture"),
            },
          },
        ],
        combined_expected_source_revisions: {
          idle: revision("idle_style"),
          idle_pose: revision("gesture"),
        },
        diagnostics: [
          {
            root_key: "catalog:avatar",
            code: "root_declaration_conflict",
            message:
              "The same catalog source was declared with conflicting requirements.",
            item_id: "avatar",
          },
        ],
      },
    });

    const failure = await resolveCreationEvidence(
      client(),
      "owner",
      draft,
    ).catch((error) => error as AnimaCreationApiError);
    if (!(failure instanceof AnimaCreationApiError))
      throw new Error("Expected conflicting source failure");

    expect(evidence.mock.calls[0]?.[0].body.roots).toEqual(
      expect.arrayContaining([
        { kind: "avatar", source: ref("avatar") },
        { kind: "gesture", source: ref("avatar") },
      ]),
    );
    expect(
      failure.failure.detail.issues.map(
        (issue: { path: string }) => issue.path,
      ),
    ).toEqual(["/avatar", "/gestures/0/source"]);
  });
  it("preserves choices and reports every affected Reaction cell when a shared support changes", async () => {
    const draft = readyDraft();
    draft.reactions = setReaction(draft, "joy", "1", ref("reaction"));
    draft.reactions = setReaction(draft, "anger", "3", ref("reaction"));
    const withEvidence = {
      ...draft,
      evidence: {
        ...draft.evidence,
        reaction: {
          source: ref("reaction"),
          revisions: {
            reaction: revision("reaction"),
            support: revision("gesture"),
          },
        },
      },
    };
    evidence.mockResolvedValue(
      evidenceResult([
        {
          id: "avatar",
          kind: "avatar",
          revisions: { avatar: revision("avatar") },
        },
        {
          id: "reaction",
          kind: "reaction",
          revisions: {
            reaction: revision("reaction"),
            support: revision("gesture", "b"),
          },
        },
        {
          id: "idle",
          kind: "idle_style",
          revisions: {
            idle: revision("idle_style"),
            idle_pose: revision("gesture"),
          },
        },
      ]),
    );
    const failure = await resolveCreationEvidence(
      client(),
      "owner",
      withEvidence,
    ).catch((error) => error as AnimaCreationApiError);
    if (!(failure instanceof AnimaCreationApiError))
      throw new Error("Expected stale source failure");
    expect(
      failure.failure.detail.issues.map(
        (issue: { path: string }) => issue.path,
      ),
    ).toEqual(["/reactions/joy/1", "/reactions/anger/3"]);
    expect(withEvidence.reactions.joy["1"]).toEqual(ref("reaction"));
    expect(withEvidence.evidence.reaction.revisions.support).toEqual(
      revision("gesture"),
    );
  });
});
