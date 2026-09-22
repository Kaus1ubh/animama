import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPose, type Avatar } from "@/lib/avatar";
import {
  usePoseCreatorStore,
  type PoseCreatorSavedDraft,
} from "@/stores/pose-creator-store";
import { replacePoseCreatorDraftWithAnimaPose } from "@/ui/pose-creator/poseCreatorAuthoring";
import { confirmPoseCreatorDirtyReplacement } from "@/ui/pose-creator/poseCreatorDirtyGuard";
import {
  editActionEditorSavedPose,
  setActionEditorAuthoringMode,
} from "./actionEditorSavedPose";

vi.mock("@/ui/pose-creator/poseCreatorAuthoring", () => ({
  replacePoseCreatorDraftWithAnimaPose: vi.fn(),
}));
vi.mock("@/ui/pose-creator/poseCreatorDirtyGuard", () => ({
  confirmPoseCreatorDirtyReplacement: vi.fn(),
}));

const draft: PoseCreatorSavedDraft = {
  id: "wave",
  name: "Wave",
  createdAt: "2026-09-22T12:00:00.000Z",
  updatedAt: "2026-09-22T12:00:00.000Z",
  source: {
    key: "preview",
    sourceType: "resolved_entry",
    displayName: "Avatar",
    sourceLabel: "Preview Anima",
    versionLabel: "Current",
  },
  basePose: "relaxedRest",
  pose: parseAnimaPose({ schema: "animaPose/1.0", id: "wave", name: "Wave" }),
};
const avatar = {} as Avatar;
const replacement = {
  boneDrafts: {},
  expressionDrafts: { happy: { baseValue: 0, value: 0.7 } },
};

beforeEach(() => {
  usePoseCreatorStore.getState().resetWorkspace();
  usePoseCreatorStore.setState({
    savedDrafts: [draft],
    activeAvatar: avatar,
    authoringMode: "clip",
    clipPlaybackPlaying: true,
  });
  vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(true);
  vi.mocked(replacePoseCreatorDraftWithAnimaPose).mockReturnValue(replacement);
});
afterEach(() => vi.clearAllMocks());

describe("editing a saved pose from a clip", () => {
  it("loads the selected pose for live editing and retains its Save identity without changing the clip", () => {
    const clip = usePoseCreatorStore.getState().clipDraft;
    expect(editActionEditorSavedPose(draft)).toBe(true);
    const state = usePoseCreatorStore.getState();
    expect(replacePoseCreatorDraftWithAnimaPose).toHaveBeenCalledWith(
      avatar,
      draft.pose,
      draft.basePose,
    );
    expect(state).toMatchObject({
      authoringMode: "pose",
      clipPlaybackPlaying: false,
      selectedSavedDraftId: draft.id,
      draftName: draft.name,
      basePose: draft.basePose,
      expressionDrafts: replacement.expressionDrafts,
      isDirty: false,
      clipInlineEdit: null,
    });
    expect(state.clipDraft).toBe(clip);
    const saved = state.saveLocalDraft({
      source: {
        ...draft.source,
        animaId: "preview-anima",
        effectiveRevision: "preview-revision",
        contentRevision: "preview-content",
        runtimeId: "primary",
        configSchemaVersion: 1,
        config: {},
      },
      basePose: "relaxedRest",
      pose: draft.pose,
    });
    expect(saved?.id).toBe(draft.id);
    expect(usePoseCreatorStore.getState().savedDrafts).toHaveLength(1);
  });

  it("preserves saved and unsaved pose edits across Clip and Pose round trips", () => {
    editActionEditorSavedPose(draft);
    const before = usePoseCreatorStore.getState();
    setActionEditorAuthoringMode("clip");
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
    setActionEditorAuthoringMode("pose");
    expect(usePoseCreatorStore.getState()).toMatchObject({
      authoringMode: "pose",
      selectedSavedDraftId: draft.id,
      draftName: draft.name,
      expressionDrafts: before.expressionDrafts,
      clipInlineEdit: null,
    });
    usePoseCreatorStore.setState({ selectedSavedDraftId: null, isDirty: true });
    setActionEditorAuthoringMode("clip");
    setActionEditorAuthoringMode("pose");
    expect(usePoseCreatorStore.getState().authoringMode).toBe("pose");
    expect(usePoseCreatorStore.getState().expressionDrafts).toEqual(
      before.expressionDrafts,
    );
  });

  it("leaves the pose and clip untouched when dirty replacement is declined", () => {
    usePoseCreatorStore.setState({ isDirty: true });
    vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(false);
    const before = usePoseCreatorStore.getState();
    expect(editActionEditorSavedPose(draft)).toBe(false);
    expect(confirmPoseCreatorDirtyReplacement).toHaveBeenCalledWith(true);
    expect(replacePoseCreatorDraftWithAnimaPose).not.toHaveBeenCalled();
    expect(usePoseCreatorStore.getState()).toBe(before);
  });

  it("protects pending inline edits, then leaves inline mode when replacement is accepted", () => {
    const store = usePoseCreatorStore.getState();
    store.addPoseToClip(draft.pose, draft.name, { atPlayhead: true });
    const clip = usePoseCreatorStore.getState().clipDraft;
    const keyframe = clip.keyframes[0]!;
    store.beginClipInlinePoseEdit({
      alias: keyframe.pose,
      keyframeId: keyframe.id,
      originalPose: clip.poses[keyframe.pose]!,
      boneDrafts: {},
      expressionDrafts: {},
      draftName: "Keyframe",
    });
    store.setExpressionDraft("happy", { baseValue: 0, value: 0.2 });
    vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(false);
    expect(editActionEditorSavedPose(draft)).toBe(false);
    expect(confirmPoseCreatorDirtyReplacement).toHaveBeenCalledWith(true);
    expect(usePoseCreatorStore.getState().clipInlineEdit).not.toBeNull();

    vi.mocked(confirmPoseCreatorDirtyReplacement).mockReturnValue(true);
    expect(editActionEditorSavedPose(draft)).toBe(true);
    expect(usePoseCreatorStore.getState().clipInlineEdit).toBeNull();
    expect(usePoseCreatorStore.getState().clipDraft).toEqual(clip);
    expect(usePoseCreatorStore.getState().selectedSavedDraftId).toBe(draft.id);
  });

  it("does not change modes without an active avatar or after failed conversion", () => {
    usePoseCreatorStore.setState({ activeAvatar: null });
    expect(editActionEditorSavedPose(draft)).toBe(false);
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
    usePoseCreatorStore.setState({ activeAvatar: avatar });
    vi.mocked(replacePoseCreatorDraftWithAnimaPose).mockImplementation(() => {
      throw new Error("Unsupported pose");
    });
    expect(editActionEditorSavedPose(draft)).toBe(false);
    expect(usePoseCreatorStore.getState().selectedSavedDraftId).toBeNull();
    expect(usePoseCreatorStore.getState().authoringMode).toBe("clip");
  });
});
