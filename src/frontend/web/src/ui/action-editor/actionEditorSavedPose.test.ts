import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { parseAnimaPose, type Avatar } from "@/lib/avatar";
import { fetchPoseNames } from "@/query/hooks/usePoses";
import { loadPoseContent } from "@/lib/content/poseContent";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { replacePoseCreatorDraftWithAnimaPose } from "@/ui/pose-creator/poseCreatorAuthoring";
import { confirmPoseCreatorDirtyReplacement } from "@/ui/pose-creator/poseCreatorDirtyGuard";
import {
  editActionEditorSavedPose,
  insertActionEditorSavedPose,
  setActionEditorAuthoringMode,
} from "./actionEditorSavedPose";

vi.mock("@/query/hooks/usePoses", () => ({ fetchPoseNames: vi.fn() }));

vi.mock("@/lib/content/poseContent", async (original) => ({
  ...(await original<typeof import("@/lib/content/poseContent")>()),
  loadPoseContent: vi.fn(),
}));
vi.mock("@/ui/pose-creator/poseCreatorAuthoring", async (original) => ({
  ...(await original<
    typeof import("@/ui/pose-creator/poseCreatorAuthoring")
  >()),
  replacePoseCreatorDraftWithAnimaPose: vi.fn(),
}));
vi.mock("@/ui/pose-creator/poseCreatorDirtyGuard", () => ({
  confirmPoseCreatorDirtyReplacement: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item: PyPose = {
  item_id: "wave-item",
  name: "Wave",
  kind: "pose",
  source: "local",
  pose_id: "wave",
  logical_key: "wave",
  revision_sha256: "rev",
  editable: true,
};
const pose = parseAnimaPose({
  schema: "animaPose/1.0",
  id: "wave",
  name: "Wave",
  expressions: { happy: 0.7 },
});
const avatar = {
  applyPose: vi.fn(),
  clearAllExpressionOverrides: vi.fn(),
} as unknown as Avatar;
const replacement = {
  boneDrafts: {},
  expressionDrafts: { happy: { baseValue: 0, value: 0.7 } },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  usePoseCreatorStore.setState({
    activeAvatar: avatar,
    authoringMode: "clip",
    clipPlaybackPlaying: true,
  });
  vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(true);
  vi.mocked(replacePoseCreatorDraftWithAnimaPose).mockReturnValue(replacement);
  vi.mocked(loadPoseContent).mockResolvedValue({ item, pose });
  vi.mocked(fetchPoseNames).mockResolvedValue(["Wave", "Wave 1"]);
});
afterEach(() => vi.clearAllMocks());

describe("editing durable poses", () => {
  it("opens a fresh standalone pose without adding captured clip content", () => {
    const clip = usePoseCreatorStore.getState().clipDraft;
    setActionEditorAuthoringMode("pose");
    expect(usePoseCreatorStore.getState().authoringMode).toBe("pose");
    setActionEditorAuthoringMode("clip");
    setActionEditorAuthoringMode("pose");
    expect(usePoseCreatorStore.getState().authoringMode).toBe("pose");
    expect(usePoseCreatorStore.getState().clipDraft).toBe(clip);
    expect(clip.keyframes).toEqual([]);
    expect(clip.motion).toEqual({ beats: [] });
  });

  it("loads Local identity/revision independently of the clip and resumes the draft", async () => {
    const clip = usePoseCreatorStore.getState().clipDraft;
    expect(await editActionEditorSavedPose(testApiClient, item)).toBe(true);
    expect(usePoseCreatorStore.getState()).toMatchObject({
      authoringMode: "pose",
      clipPlaybackPlaying: false,
      draftName: "Wave",
      savedPoseIdentity: {
        itemId: "wave-item",
        poseId: "wave",
        revision: "rev",
      },
      isDirty: false,
      clipInlineEdit: null,
    });
    expect(usePoseCreatorStore.getState().clipDraft).toBe(clip);
    setActionEditorAuthoringMode("clip");
    setActionEditorAuthoringMode("pose");
    expect(usePoseCreatorStore.getState().authoringMode).toBe("pose");
  });
  it("customizes Included poses into unsaved Local copies", async () => {
    expect(
      await editActionEditorSavedPose(testApiClient, {
        ...item,
        source: "included",
        editable: false,
      }),
    ).toBe(true);
    expect(usePoseCreatorStore.getState()).toMatchObject({
      savedPoseIdentity: null,
      draftName: "Wave 2",
      isDirty: true,
    });
  });
  it("keeps the latest selected pose when an older request resolves first", async () => {
    const earlier = deferred<{ item: PyPose; pose: typeof pose }>();
    const latest = deferred<{ item: PyPose; pose: typeof pose }>();
    vi.mocked(loadPoseContent)
      .mockReturnValueOnce(earlier.promise)
      .mockReturnValueOnce(latest.promise);
    const first = editActionEditorSavedPose(testApiClient, item);
    const nextItem = {
      ...item,
      item_id: "next-item",
      name: "Next",
      pose_id: "next",
    };
    const nextPose = { ...pose, id: "next", name: "Next" };
    const second = editActionEditorSavedPose(testApiClient, nextItem);
    earlier.resolve({ item, pose });
    expect(await first).toBe(false);
    latest.resolve({ item: nextItem, pose: nextPose });
    expect(await second).toBe(true);
    expect(usePoseCreatorStore.getState().savedPoseIdentity?.itemId).toBe(
      "next-item",
    );
  });

  it("does not fetch or replace edits when dirty replacement is declined", async () => {
    usePoseCreatorStore.setState({ isDirty: true });
    vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(false);
    const before = usePoseCreatorStore.getState();
    expect(await editActionEditorSavedPose(testApiClient, item)).toBe(false);
    expect(loadPoseContent).not.toHaveBeenCalled();
    expect(usePoseCreatorStore.getState()).toBe(before);
  });
  it.each(["new-session", "edit", "closed"])(
    "rejects a late load after %s",
    async (reason) => {
      const pending = deferred<{ item: PyPose; pose: typeof pose }>();
      vi.mocked(loadPoseContent).mockReturnValue(pending.promise);
      let active = true;
      const load = editActionEditorSavedPose(testApiClient, item, {
        isCurrent: () => active,
      });
      if (reason === "new-session")
        usePoseCreatorStore.getState().startNewPose();
      if (reason === "edit")
        usePoseCreatorStore.getState().setDraftName("Pending work");
      if (reason === "closed") active = false;
      const before = usePoseCreatorStore.getState();
      pending.resolve({ item, pose });
      expect(await load).toBe(false);
      expect(usePoseCreatorStore.getState()).toBe(before);
    },
  );
});

describe("asynchronous copy insertion", () => {
  it("copies at the captured click time even if the playhead moves while loading", async () => {
    const pending = deferred<{ item: PyPose; pose: typeof pose }>();
    vi.mocked(loadPoseContent).mockReturnValue(pending.promise);
    usePoseCreatorStore.getState().setClipCurrentTime(0.2);
    const inserting = insertActionEditorSavedPose(testApiClient, item);
    usePoseCreatorStore.getState().setClipCurrentTime(0.8);
    pending.resolve({ item, pose });
    expect(await inserting).toBe(true);
    expect(usePoseCreatorStore.getState().clipDraft.keyframes[0].time).toBe(
      0.2,
    );
    expect(usePoseCreatorStore.getState().clipUndoHistory).toHaveLength(1);
  });
  it.each(["new-session", "edit", "closed"])(
    "preserves the timeline after obsolete %s resolution",
    async (reason) => {
      const pending = deferred<{ item: PyPose; pose: typeof pose }>();
      vi.mocked(loadPoseContent).mockReturnValue(pending.promise);
      let active = true;
      const inserting = insertActionEditorSavedPose(testApiClient, item, {
        isCurrent: () => active,
      });
      if (reason === "new-session")
        usePoseCreatorStore.getState().resetClipDraft();
      if (reason === "edit")
        usePoseCreatorStore.getState().updateClipDraft({ name: "Changed" });
      if (reason === "closed") active = false;
      const before = usePoseCreatorStore.getState();
      pending.resolve({ item, pose });
      expect(await inserting).toBe(false);
      expect(usePoseCreatorStore.getState()).toBe(before);
    },
  );
  it.each(["initial", "during-load"])(
    "preserves the clip when its Avatar is unavailable %s",
    async (when) => {
      const pending = deferred<{ item: PyPose; pose: typeof pose }>();
      vi.mocked(loadPoseContent).mockReturnValue(pending.promise);
      if (when === "initial")
        usePoseCreatorStore.setState({ activeAvatar: null });
      const inserting = insertActionEditorSavedPose(testApiClient, item);
      if (when === "during-load")
        usePoseCreatorStore.setState({ activeAvatar: null });
      const before = usePoseCreatorStore.getState();
      pending.resolve({ item, pose });
      expect(await inserting).toBe(false);
      expect(usePoseCreatorStore.getState()).toBe(before);
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledWith(
        expect.stringMatching(/Avatar/i),
      );
      if (when === "initial") expect(loadPoseContent).not.toHaveBeenCalled();
    },
  );
  it("reports failure when atomic baking cannot resolve a pre-existing reference", async () => {
    usePoseCreatorStore.setState((state) => ({
      clipDraft: { ...state.clipDraft, basePose: "missing-base" },
    }));
    const before = usePoseCreatorStore.getState();
    expect(await insertActionEditorSavedPose(testApiClient, item)).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringMatching(/unavailable|invalid/i),
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(usePoseCreatorStore.getState().clipDraft).toBe(before.clipDraft);
    expect(usePoseCreatorStore.getState().clipUndoHistory).toEqual(
      before.clipUndoHistory,
    );
  });
});
