import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { PoseEditorSession } from "./poseEditorSession";

const harness = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/ui/action-editor/actionEditorSavedPose", () => ({
  editActionEditorSavedPose: harness.load,
}));

const local: PyPose = {
  item_id: "local-item",
  pose_id: "local:pose:one",
  logical_key: "local:pose:one",
  name: "One",
  revision_sha256: "r1",
  source: "local",
  editable: true,
};

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  harness.load.mockReset();
  harness.load.mockImplementation(
    async (
      _client: unknown,
      item: PyPose,
      options: { isCurrent: () => boolean },
    ) => {
      if (!options.isCurrent()) return false;
      usePoseCreatorStore.getState().loadPoseDocument(
        item.source === "local"
          ? {
              itemId: item.item_id,
              poseId: item.pose_id,
              logicalKey: item.logical_key ?? null,
              revision: item.revision_sha256,
              name: item.name,
            }
          : null,
        {
          draftName: item.name,
          basePose: "__vrm_t_pose__",
          boneDrafts: {},
          expressionDrafts: {},
        },
      );
      return true;
    },
  );
});

describe("standalone Pose editor session", () => {
  it("loads a Local pose without creating or changing a Gesture timeline", async () => {
    const store = usePoseCreatorStore.getState();
    store.updateClipDraft({ name: "Suspended Gesture" });
    const clip = usePoseCreatorStore.getState().clipDraft;
    const session = new PoseEditorSession();
    session.activate(local.item_id);
    expect(await session.load(testApiClient, local)).toBe(true);
    expect(usePoseCreatorStore.getState().savedPoseIdentity?.itemId).toBe(
      local.item_id,
    );
    expect(usePoseCreatorStore.getState().clipDraft).toBe(clip);
    expect(usePoseCreatorStore.getState().authoringMode).toBe("pose");
  });

  it("does not reload server refreshes over unsaved edits", async () => {
    const session = new PoseEditorSession();
    session.activate(local.item_id);
    await session.load(testApiClient, local);
    usePoseCreatorStore.getState().setDraftName("Unsaved edit");
    expect(
      await session.load(testApiClient, { ...local, revision_sha256: "newer" }),
    ).toBe(true);
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(usePoseCreatorStore.getState().draftName).toBe("Unsaved edit");
  });

  it("keeps a customized Local draft on its canonical URL after Save", async () => {
    const session = new PoseEditorSession();
    const starter = {
      ...local,
      item_id: "starter",
      source: "included" as const,
      editable: false,
    };
    session.activate(starter.item_id);
    await session.load(testApiClient, starter);
    expect(usePoseCreatorStore.getState().savedPoseIdentity).toBeNull();
    usePoseCreatorStore.getState().setDraftName("Further edits after Save");
    const token = usePoseCreatorStore.getState().poseSessionToken;
    session.adoptSavedItem(local.item_id);
    session.activate(local.item_id);
    expect(await session.load(testApiClient, local)).toBe(true);
    expect(harness.load).toHaveBeenCalledTimes(1);
    expect(usePoseCreatorStore.getState().poseSessionToken).toBe(token);
    expect(usePoseCreatorStore.getState().draftName).toBe(
      "Further edits after Save",
    );
  });

  it("ignores pending loads after navigation and permits explicit retry after failure", async () => {
    let finish!: () => void;
    harness.load.mockImplementationOnce(
      async (
        _client: unknown,
        _item: PyPose,
        options: { isCurrent: () => boolean },
      ) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return options.isCurrent();
      },
    );
    const session = new PoseEditorSession();
    session.activate(local.item_id);
    const pending = session.load(testApiClient, local);
    session.activate("another-item");
    finish();
    expect(await pending).toBe(false);
    expect(session.isLoaded("another-item")).toBe(false);
    const another = { ...local, item_id: "another-item" };
    harness.load.mockResolvedValueOnce(false);
    expect(await session.load(testApiClient, another)).toBe(false);
    expect(await session.load(testApiClient, another)).toBe(true);
  });
});
