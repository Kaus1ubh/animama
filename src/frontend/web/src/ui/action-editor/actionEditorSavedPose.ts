import type { Client } from "@animama/runtime-contracts/sdk";
import { getI18n } from "react-i18next";
import { toast } from "sonner";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { failureLine, WordedError } from "@/lib/errors/apiError";
import { loadPoseContent, poseSavedIdentity } from "@/lib/content/poseContent";
import { fetchPoseNames } from "@/query/hooks/usePoses";
import type { ActionEditorMode } from "./actionEditorCapabilities";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  createUniquePoseCreatorBranchName,
  replacePoseCreatorDraftWithAnimaPose,
} from "@/ui/pose-creator/poseCreatorAuthoring";
import { confirmPoseCreatorDirtyReplacement } from "@/ui/pose-creator/poseCreatorDirtyGuard";

let poseLoadRequest = 0;

type CurrentGuard = { isCurrent?: () => boolean };

/** Load Local content for editing; Included and explicit copies start unsaved Local drafts. */
export async function editActionEditorSavedPose(
  apiClient: Client,
  item: PyPose,
  options: CurrentGuard & { customize?: boolean } = {},
): Promise<boolean> {
  const t = getI18n().getFixedT(null, "actionEditor");
  const state = usePoseCreatorStore.getState();
  if (!state.activeAvatar) {
    toast.error(t("savedPose.avatarRequiredToEdit"));
    return false;
  }
  if (
    !confirmPoseCreatorDirtyReplacement(
      state.isDirty || Boolean(state.clipInlineEdit?.isDirty),
    )
  )
    return false;
  const request = ++poseLoadRequest;
  try {
    const copy = options.customize || item.source === "included";
    const [document, existingNames] = await Promise.all([
      loadPoseContent(apiClient, item),
      copy ? fetchPoseNames(apiClient) : Promise.resolve([]),
    ]);
    const current = usePoseCreatorStore.getState();
    if (
      request !== poseLoadRequest ||
      options.isCurrent?.() === false ||
      current.poseSessionToken !== state.poseSessionToken ||
      current.activeAvatar !== state.activeAvatar ||
      current.boneDrafts !== state.boneDrafts ||
      current.expressionDrafts !== state.expressionDrafts ||
      current.draftName !== state.draftName ||
      current.basePose !== state.basePose ||
      current.clipInlineEdit !== state.clipInlineEdit
    )
      return false;
    const replacement = replacePoseCreatorDraftWithAnimaPose(
      state.activeAvatar,
      document.pose,
      POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    );
    current.cancelClipInlinePoseEdit();
    current.loadPoseDocument(copy ? null : poseSavedIdentity(document.item), {
      draftName: copy
        ? createUniquePoseCreatorBranchName(item.name, existingNames)
        : item.name,
      basePose: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
      ...replacement,
    });
    current.setAuthoringMode("pose");
    return true;
  } catch (error) {
    if (
      request === poseLoadRequest &&
      options.isCurrent?.() !== false &&
      usePoseCreatorStore.getState().poseSessionToken === state.poseSessionToken
    ) {
      toast.error(failureLine(error, t("savedPose.loadFailed")));
    }
    return false;
  }
}

/** Document fingerprint excludes seek and selection, so delayed copies use the captured time. */
function clipContentFingerprint(
  state: ReturnType<typeof usePoseCreatorStore.getState>,
): string {
  const draft = state.clipDraft;
  return JSON.stringify({
    id: draft.id,
    name: draft.name,
    duration: draft.duration,
    loop: draft.loop,
    basePose: draft.basePose,
    fadeIn: draft.fadeIn,
    fadeOut: draft.fadeOut,
    keyframes: draft.keyframes,
    motion: draft.motion,
    events: draft.events,
  });
}

/** Click and drag share one checked fetch followed by the store's atomic copy operation. */
export async function insertActionEditorSavedPose(
  apiClient: Client,
  item: PyPose,
  options: CurrentGuard & { timeSec?: number } = {},
): Promise<boolean> {
  const t = getI18n().getFixedT(null, "actionEditor");
  const captured = usePoseCreatorStore.getState();
  if (!captured.activeAvatar) {
    toast.error(t("savedPose.avatarRequiredToInsert"));
    return false;
  }
  const fingerprint = clipContentFingerprint(captured);
  const timeSec = options.timeSec ?? captured.clipDraft.currentTimeSec;
  try {
    const { pose } = await loadPoseContent(apiClient, item);
    const current = usePoseCreatorStore.getState();
    if (
      options.isCurrent?.() === false ||
      current.clipSessionToken !== captured.clipSessionToken ||
      clipContentFingerprint(current) !== fingerprint
    )
      return false;
    if (
      !current.activeAvatar ||
      current.activeAvatar !== captured.activeAvatar
    ) {
      throw new WordedError(t("savedPose.avatarChanged"));
    }
    const inserted = current.addPoseToClip(pose, item.name, { timeSec });
    if (!inserted) throw new WordedError(t("savedPose.insertInvalid"));
    toast.success(t("savedPose.inserted"));
    return true;
  } catch (error) {
    if (
      options.isCurrent?.() !== false &&
      usePoseCreatorStore.getState().clipSessionToken ===
        captured.clipSessionToken
    ) {
      toast.error(failureLine(error, t("savedPose.insertFailed")));
    }
    return false;
  }
}

/** Keep new and saved standalone Pose drafts separate from clip keyframes. */
export function setActionEditorAuthoringMode(mode: ActionEditorMode): void {
  const state = usePoseCreatorStore.getState();
  const resumePose =
    mode === "pose" &&
    !state.clipInlineEdit &&
    (state.savedPoseIdentity !== null ||
      state.isDirty ||
      state.clipDraft.keyframes.length === 0);
  state.setAuthoringMode(resumePose ? "pose" : "clip");
}
