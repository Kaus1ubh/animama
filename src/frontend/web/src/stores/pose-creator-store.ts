"use client";

import { VRMHumanBoneList, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion } from "three";
import { getI18n } from "react-i18next";
import { create } from "zustand";
import { convertPoseQuaternionBasis } from "@/lib/avatar/poses/poseRetargeting";

import {
  isAnimaPoseClipVFXEvent,
  type AnimaPoseClipV2,
  type AnimaPoseClipEvent,
  type AnimaPoseClipSceneVFXKind,
  type AnimaPoseSnapshot,
  type Avatar,
  type AvatarLoadProgress,
  type ParticleVFXCatalogEntry,
} from "@/lib/avatar";
import {
  parseAnimaPose,
  resolveAnimaPose,
  type AnimaPose,
} from "@/lib/avatar/poses/animaPose";
import {
  AVATAR_POSE_IDS,
  RELAXED_REST_POSE_ID,
  getAvatarPose,
  getResolvedAvatarPose,
} from "@/lib/avatar/poses/catalog";
import type {
  HandShape,
  HandSide,
} from "@/lib/avatar/poses/anatomy/handPresets";
import {
  clampPoseCreatorClipTime,
  clonePoseCreatorClipEvent,
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipAvatarVFXEventDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  createPoseCreatorClipParticleVFXEventDraft,
  createPoseCreatorClipSceneVFXEventDraft,
  createPoseCreatorClipSFXEventDraft,
  generatePoseCreatorClipEventId,
  normalizePoseCreatorClipPlaybackSpeed,
  normalizePoseCreatorClipSnapInterval,
  patchPoseCreatorClipDraft,
  patchPoseCreatorClipEventDraft,
  snapPoseCreatorClipTime,
  sortPoseCreatorClipEvents,
  sortPoseCreatorClipKeyframes,
  withPoseCreatorClipValidation,
  DEFAULT_POSE_CREATOR_CLIP_PLAYBACK_SPEED,
  POSE_CREATOR_CLIP_FRAME_STEP_SEC,
  DEFAULT_POSE_CREATOR_CLIP_SNAP_INTERVAL_SEC,
  type PoseCreatorAuthoringMode,
  type PoseCreatorClipDraft,
  type PoseCreatorClipDraftPatch,
  type PoseCreatorClipEventDraftPatch,
  type PoseCreatorClipKeyframeDraft,
  type PoseCreatorClipKeyframeDraftPatch,
  type PoseCreatorClipPreviewDiagnostics,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import {
  deletePoseCreatorBeat,
  findPoseCreatorBaseBeat,
  insertPoseCreatorBeat,
  insertPoseCreatorLibraryPose,
  reposePoseCreatorBaseBeats,
  retimePoseCreatorBeat,
  setPoseCreatorBaseBeat,
  setPoseCreatorBeatEase,
  setPoseCreatorBeatExpressionsAtTime,
  setPoseCreatorBeatLabel,
  setPoseCreatorBeatPose,
} from "@/ui/pose-creator/poseCreatorClipMotion";
import type { PoseCreatorModelSource } from "@/ui/pose-creator/poseCreatorPreview";

/** Exact saved identity; canonical collection and payloads remain in Query. */
export type PoseCreatorSavedPoseIdentity = {
  itemId: string;
  poseId: string;
  logicalKey: string | null;
  revision: string;
  name: string;
};

/** Immutable values submitted by an editor Save, excluding runtime state. */
export type PoseCreatorSubmittedDraft = {
  draftName: string;
  basePose: PoseCreatorBasePose;
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
};

let editorSessionSequence = 0;
function nextEditorSessionToken(): string {
  return `pose-editor:${++editorSessionSequence}`;
}

export type PoseCreatorLoadStatus = "idle" | "loading" | "ready" | "error";
export type PoseCreatorBasePose = string;
export type PoseCreatorBasePoseOption = {
  id: PoseCreatorBasePose;
  label: string;
  source: "neutral" | "vrm";
};
export type PoseCreatorRotationAxis = "x" | "y" | "z";
export type PoseCreatorRotationDegrees = Record<
  PoseCreatorRotationAxis,
  number
>;
export type PoseCreatorQuaternionTuple = [number, number, number, number];
export type PoseCreatorVector3Tuple = [number, number, number];

export type PoseCreatorBoneDraft = {
  baseQuaternion: PoseCreatorQuaternionTuple;
  rotationDegrees: PoseCreatorRotationDegrees;
  position?: PoseCreatorVector3Tuple;
};

export type PoseCreatorExpressionDraft = {
  baseValue: number;
  value: number;
};

export type PoseCreatorBoneDrafts = Record<string, PoseCreatorBoneDraft>;
export type PoseCreatorExpressionDrafts = Record<
  string,
  PoseCreatorExpressionDraft
>;
export type PoseCreatorBoneFocusRequest = {
  boneName: string;
  requestId: number;
};

export type PoseCreatorDraftReplacement = {
  draftName: string;
  basePose: PoseCreatorBasePose;
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
  isDirty: boolean;
  importError?: string | null;
};

/**
 * Hand shapes the Hands tool chose while editing a clip beat, per side. They
 * become the beat's hand keys on commit; the bone drafts show them.
 */
export type PoseCreatorHandShapes = Partial<Record<HandSide, HandShape>>;

export type PoseCreatorClipInlineEditState = {
  alias: string;
  keyframeId: string | null;
  originalPose: AnimaPoseSnapshot;
  previousBoneDrafts: PoseCreatorBoneDrafts;
  previousExpressionDrafts: PoseCreatorExpressionDrafts;
  previousDraftName: string;
  previousIsDirty: boolean;
  isDirty: boolean;
  /** Hand shapes chosen in this edit; absent until the Hands tool sets one. */
  handShapes?: PoseCreatorHandShapes;
};

type PoseCreatorPoseUndoSnapshot = {
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
  isDirty: boolean;
};

type PoseCreatorClipUndoSnapshot = {
  basePose: string;
  /** The beats and tracks (edits replace them, so no copy is needed). */
  motion: PoseCreatorClipDraft["motion"];
  keyframes: PoseCreatorClipDraft["keyframes"];
  events: PoseCreatorClipDraft["events"];
  selectedKeyframeId: string | null;
  selectedPoseAlias: string | null;
  selectedEventId: string | null;
  currentTimeSec: number;
  isDirty: boolean;
};

type PoseCreatorInlinePoseUndoSnapshot = {
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
  isDirty: boolean;
  handShapes?: PoseCreatorHandShapes;
};

type PoseCreatorUndoGroup =
  | {
      kind: "pose";
      depth: number;
      snapshot: PoseCreatorPoseUndoSnapshot;
    }
  | {
      kind: "clip";
      depth: number;
      snapshot: PoseCreatorClipUndoSnapshot;
    }
  | {
      kind: "inline_pose";
      depth: number;
      snapshot: PoseCreatorInlinePoseUndoSnapshot;
    };

// Give new pose sessions an immediately usable rotation handle. Explicit bone
// selections remain independent of helper visibility and model loading.
const DEFAULT_POSE_CREATOR_SELECTED_BONE = "leftUpperArm";

export const POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID = "__vrm_t_pose__";
export const DEFAULT_POSE_CREATOR_BASE_POSE: PoseCreatorBasePose =
  RELAXED_REST_POSE_ID;
export const POSE_CREATOR_UNDO_HISTORY_LIMIT = 50;
export const POSE_CREATOR_CLIP_VALIDATION_OPTIONS = {
  knownPoseIds: AVATAR_POSE_IDS,
  omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
} as const;

export const POSE_CREATOR_BASE_POSE_OPTIONS: PoseCreatorBasePoseOption[] = [
  {
    id: RELAXED_REST_POSE_ID,
    label: getAvatarPose(RELAXED_REST_POSE_ID).name,
    source: "neutral",
  },
  {
    id: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    label: "VRM T-Pose",
    source: "vrm",
  },
];

export function isPoseCreatorBasePose(
  value: string,
): value is PoseCreatorBasePose {
  return POSE_CREATOR_BASE_POSE_OPTIONS.some((option) => option.id === value);
}

export function getPoseCreatorBasePoseLabel(
  basePose: PoseCreatorBasePose,
): string {
  return (
    POSE_CREATOR_BASE_POSE_OPTIONS.find((option) => option.id === basePose)
      ?.label ?? basePose
  );
}

function hasCurrentSavedDraft(state: PoseCreatorStoreState): boolean {
  return state.savedPoseIdentity !== null;
}

function getDirtyStateAfterDraftMutation(
  state: PoseCreatorStoreState,
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
): boolean {
  return hasDrafts(boneDrafts, expressionDrafts) || hasCurrentSavedDraft(state);
}

/**
 * In-progress editor and playback state only.
 *
 * Saved identity and editor tokens fence asynchronous content operations.
 * Canonical collections belong to TanStack Query; this store never persists
 * a second browser pose library.
 */
type PoseCreatorStoreState = {
  authoringMode: PoseCreatorAuthoringMode;
  selectedSource: PoseCreatorModelSource | null;
  basePose: PoseCreatorBasePose;
  activeAvatar: Avatar | null;
  loadStatus: PoseCreatorLoadStatus;
  loadError: string | null;
  loadProgress: AvatarLoadProgress | null;
  selectedBone: string | null;
  selectedBoneFocusRequest: PoseCreatorBoneFocusRequest | null;
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
  boneHelperNodesVisible: boolean;
  mirrorOppositeBone: boolean;
  isDirty: boolean;
  exportPreview: string | null;
  draftName: string;
  savedPoseIdentity: PoseCreatorSavedPoseIdentity | null;
  poseSessionToken: string;
  clipSessionToken: string;
  importError: string | null;
  clipDraft: PoseCreatorClipDraft;
  clipInlineEdit: PoseCreatorClipInlineEditState | null;
  clipSnapEnabled: boolean;
  clipSnapIntervalSec: number;
  clipPreviewDiagnostics: PoseCreatorClipPreviewDiagnostics;
  clipPlaybackPlaying: boolean;
  clipPlaybackAbsoluteTimeSec: number;
  clipPreviewClearRevision: number;
  clipPlaybackCompletedRevision: number;
  clipPlaybackSpeed: number;
  poseUndoHistory: PoseCreatorPoseUndoSnapshot[];
  poseRedoHistory: PoseCreatorPoseUndoSnapshot[];
  clipUndoHistory: PoseCreatorClipUndoSnapshot[];
  clipRedoHistory: PoseCreatorClipUndoSnapshot[];
  inlinePoseUndoHistory: PoseCreatorInlinePoseUndoSnapshot[];
  inlinePoseRedoHistory: PoseCreatorInlinePoseUndoSnapshot[];
  undoGroup: PoseCreatorUndoGroup | null;
  /** Synchronous notification lets live tools finish before history navigation. */
  historyRequestRevision: number;
  setAuthoringMode: (mode: PoseCreatorAuthoringMode) => void;
  beginPoseUndoGroup: () => void;
  endPoseUndoGroup: () => void;
  beginClipUndoGroup: () => void;
  endClipUndoGroup: () => void;
  undoPose: () => void;
  redoPose: () => void;
  undoClip: () => void;
  redoClip: () => void;
  clearPoseUndoHistory: () => void;
  clearClipUndoHistory: () => void;
  updateClipDraft: (patch: PoseCreatorClipDraftPatch) => void;
  resetClipDraft: (name?: string) => void;
  hydrateClipDocument: (
    clip: AnimaPoseClipV2,
    options?: {
      fallbackBasePose?: PoseCreatorBasePose;
      /** Preserve the authoring playhead during in-place document updates. */
      currentTimeSec?: number;
    },
  ) => boolean;
  markClipDocumentSaved: (name: string) => void;
  replaceClipDraftFromImport: (draft: PoseCreatorClipDraft) => void;
  setClipCurrentTime: (time: number, options?: { snap?: boolean }) => void;
  setClipSnapEnabled: (enabled: boolean) => void;
  setClipSnapInterval: (interval: number) => void;
  setClipPreviewDiagnostics: (
    diagnostics: PoseCreatorClipPreviewDiagnostics,
  ) => void;
  playClipPreview: () => void;
  pauseClipPreview: () => void;
  stopClipPreview: () => void;
  restartClipPreview: () => void;
  setClipPlaybackSpeed: (speed: number) => void;
  advanceClipPlayback: (deltaSeconds: number) => void;
  stepClipTime: (direction: -1 | 1) => void;
  stepClipKeyframe: (direction: -1 | 1) => void;
  /** Select one keyframe and clear event selection; null only clears keyframes. */
  selectClipKeyframe: (keyframeId: string | null) => void;
  /** Select one event and clear keyframe selection; null only clears events. */
  selectClipEvent: (eventId: string | null) => void;
  insertClipAvatarVFXEventAtPlayhead: (
    effectId: string,
    options?: { linkedSfxCueId?: string | null },
  ) => void;
  insertClipSceneVFXEventAtPlayhead: (
    sceneKind: AnimaPoseClipSceneVFXKind,
    presetId: string,
  ) => void;
  insertClipParticleVFXEventAtPlayhead: (
    effectId: string,
    catalogEntry?: Pick<
      ParticleVFXCatalogEntry,
      "defaultAnchor" | "defaultDurationSec" | "defaultTransform"
    > | null,
  ) => void;
  insertClipSFXEventAtPlayhead: (cueId: string) => void;
  beginClipInlinePoseEdit: (input: {
    alias: string;
    keyframeId: string | null;
    originalPose: AnimaPoseSnapshot;
    boneDrafts: PoseCreatorBoneDrafts;
    expressionDrafts: PoseCreatorExpressionDrafts;
    draftName: string;
  }) => void;
  commitClipInlinePoseEdit: (pose: AnimaPose) => void;
  cancelClipInlinePoseEdit: () => void;
  /** Add a beat at the playhead that pins the motion where it is. */
  captureClipPoseAtPlayhead: () => void;
  /**
   * Add a Library Pose by value as a beat (labelled `label`) at `timeSec`,
   * or at the playhead. Returns the beat id, null when the pose or the base
   * pose does not resolve.
   */
  addPoseToClip: (
    pose: AnimaPose,
    label: string,
    options?: { timeSec?: number },
  ) => string | null;
  /** Create or update the sparse expression landmark at the playhead. */
  setClipExpressionsAtPlayhead: (expressions: Record<string, number>) => void;
  updateSelectedClipKeyframe: (
    patch: PoseCreatorClipKeyframeDraftPatch,
  ) => void;
  updateSelectedClipEvent: (patch: PoseCreatorClipEventDraftPatch) => void;
  moveClipKeyframe: (
    keyframeId: string,
    time: number,
    options?: { snap?: boolean },
  ) => void;
  moveClipEvent: (
    eventId: string,
    time: number,
    options?: { snap?: boolean },
  ) => void;
  deleteSelectedClipKeyframe: () => void;
  deleteSelectedClipEvent: () => void;
  duplicateSelectedClipEvent: () => void;
  nudgeSelectedClipEvent: (direction: -1 | 1) => void;
  clearClipEvents: (kind?: AnimaPoseClipEvent["kind"]) => void;
  setClipBaseEndpoint: (endpoint: "start" | "end", enabled: boolean) => void;
  setModelSource: (source: PoseCreatorModelSource | null) => void;
  setBasePose: (basePose: PoseCreatorBasePose) => void;
  setActiveAvatar: (avatar: Avatar | null) => void;
  setLoadStatus: (status: PoseCreatorLoadStatus, error?: string | null) => void;
  setLoadProgress: (progress: AvatarLoadProgress | null) => void;
  setSelectedBone: (boneName: string | null) => void;
  focusBone: (boneName: string) => void;
  setBoneHelperNodesVisible: (visible: boolean) => void;
  setMirrorOppositeBone: (enabled: boolean) => void;
  /**
   * Replace several bone drafts as one edit. While editing a clip beat,
   * `handShapes` also sets (or, with null, clears) the Hands tool's shape for
   * a side in the same history step; it is ignored otherwise.
   */
  setBoneDraftBatch: (
    updates: Record<string, PoseCreatorBoneDraft | null>,
    handShapes?: Partial<Record<HandSide, HandShape | null>>,
  ) => boolean;
  setBoneDraft: (boneName: string, draft: PoseCreatorBoneDraft) => void;
  removeBoneDraft: (boneName: string) => void;
  clearBoneDrafts: () => void;
  setExpressionDraft: (
    expressionName: string,
    draft: PoseCreatorExpressionDraft,
  ) => void;
  removeExpressionDraft: (expressionName: string) => void;
  clearExpressionDrafts: () => void;
  setDirty: (dirty: boolean) => void;
  setExportPreview: (preview: string | null) => void;
  setDraftName: (name: string) => void;
  setImportError: (error: string | null) => void;
  loadPoseDocument: (
    identity: PoseCreatorSavedPoseIdentity | null,
    replacement: PoseCreatorSubmittedDraft,
  ) => void;
  acknowledgePoseSave: (input: {
    sessionToken: string;
    submittedDraft: PoseCreatorSubmittedDraft;
    savedIdentity: PoseCreatorSavedPoseIdentity;
  }) => boolean;
  replaceDraftFromImport: (
    replacement: Omit<PoseCreatorDraftReplacement, "isDirty">,
  ) => void;
  startNewPose: () => void;
  resetWorkspace: () => void;
};

type PoseCreatorTransientState = Pick<
  PoseCreatorStoreState,
  | "selectedSource"
  | "activeAvatar"
  | "loadStatus"
  | "loadError"
  | "loadProgress"
  | "selectedBone"
  | "selectedBoneFocusRequest"
  | "boneDrafts"
  | "expressionDrafts"
  | "mirrorOppositeBone"
  | "isDirty"
  | "exportPreview"
  | "draftName"
  | "savedPoseIdentity"
  | "poseSessionToken"
  | "clipSessionToken"
  | "importError"
  | "clipDraft"
  | "clipInlineEdit"
  | "clipSnapEnabled"
  | "clipSnapIntervalSec"
  | "clipPreviewDiagnostics"
  | "clipPlaybackPlaying"
  | "clipPlaybackAbsoluteTimeSec"
  | "clipPreviewClearRevision"
  | "clipPlaybackCompletedRevision"
  | "clipPlaybackSpeed"
>;

function hasDrafts(
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
): boolean {
  return (
    Object.keys(boneDrafts).length > 0 ||
    Object.keys(expressionDrafts).length > 0
  );
}

function resetTransientStateForSource(
  source: PoseCreatorModelSource | null,
): PoseCreatorTransientState {
  return {
    selectedSource: source,
    activeAvatar: null,
    loadStatus: "idle",
    loadError: null,
    loadProgress: null,
    selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
    selectedBoneFocusRequest: null,
    boneDrafts: {},
    expressionDrafts: {},
    mirrorOppositeBone: true,
    isDirty: false,
    exportPreview: null,
    draftName: "",
    savedPoseIdentity: null,
    poseSessionToken: nextEditorSessionToken(),
    importError: null,
    clipSessionToken: nextEditorSessionToken(),
    clipDraft: createDefaultClipDraft(),
    clipInlineEdit: null,
    clipSnapEnabled: true,
    clipSnapIntervalSec: DEFAULT_POSE_CREATOR_CLIP_SNAP_INTERVAL_SEC,
    clipPreviewDiagnostics: createEmptyClipPreviewDiagnostics(),
    clipPlaybackPlaying: false,
    clipPlaybackAbsoluteTimeSec: 0,
    clipPreviewClearRevision: 0,
    clipPlaybackCompletedRevision: 0,
    clipPlaybackSpeed: DEFAULT_POSE_CREATOR_CLIP_PLAYBACK_SPEED,
  };
}

/** New timeline documents must not inherit a previous creator's pose scratchpad. */
function resetPoseAuthoringState(basePose = DEFAULT_POSE_CREATOR_BASE_POSE) {
  return {
    basePose,
    selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
    selectedBoneFocusRequest: null,
    boneDrafts: {},
    expressionDrafts: {},
    isDirty: false,
    poseUndoHistory: [],
    poseRedoHistory: [],
    undoGroup: null,
    exportPreview: null,
    draftName: "",
    savedPoseIdentity: null,
    poseSessionToken: nextEditorSessionToken(),
    importError: null,
  };
}

function createDefaultClipDraft(): PoseCreatorClipDraft {
  return createDefaultPoseCreatorClipDraft(
    DEFAULT_POSE_CREATOR_BASE_POSE,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
}

function withDirtyClipValidation(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipDraft {
  return withPoseCreatorClipValidation(
    {
      ...draft,
      isDirty: true,
    },
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
}

function createEmptyClipPreviewDiagnostics(): PoseCreatorClipPreviewDiagnostics {
  return {
    missingPoseRefs: [],
    missingAvatarVFXIds: [],
    missingSceneVFXPresetIds: [],
    missingParticleVFXIds: [],
    missingSFXCueIds: [],
    eventAdapterWarnings: [],
  };
}

function clonePoseCreatorBoneDrafts(
  drafts: PoseCreatorBoneDrafts,
): PoseCreatorBoneDrafts {
  return Object.fromEntries(
    Object.entries(drafts).map(([boneName, draft]) => [
      boneName,
      {
        baseQuaternion: [...draft.baseQuaternion] as PoseCreatorQuaternionTuple,
        rotationDegrees: { ...draft.rotationDegrees },
        ...(draft.position
          ? { position: [...draft.position] as PoseCreatorVector3Tuple }
          : {}),
      },
    ]),
  );
}

function clonePoseCreatorExpressionDrafts(
  drafts: PoseCreatorExpressionDrafts,
): PoseCreatorExpressionDrafts {
  return Object.fromEntries(
    Object.entries(drafts).map(([expressionName, draft]) => [
      expressionName,
      { ...draft },
    ]),
  );
}

function createPoseUndoSnapshot(
  state: PoseCreatorStoreState,
): PoseCreatorPoseUndoSnapshot {
  return {
    boneDrafts: clonePoseCreatorBoneDrafts(state.boneDrafts),
    expressionDrafts: clonePoseCreatorExpressionDrafts(state.expressionDrafts),
    isDirty: state.isDirty,
  };
}

function createClipUndoSnapshot(
  state: Pick<PoseCreatorStoreState, "clipDraft">,
): PoseCreatorClipUndoSnapshot {
  return {
    basePose: state.clipDraft.basePose,
    motion: state.clipDraft.motion,
    keyframes: state.clipDraft.keyframes.map((keyframe) => ({ ...keyframe })),
    events: state.clipDraft.events.map(clonePoseCreatorClipEvent),
    selectedKeyframeId: state.clipDraft.selectedKeyframeId,
    selectedPoseAlias: state.clipDraft.selectedPoseAlias,
    selectedEventId: state.clipDraft.selectedEventId,
    currentTimeSec: state.clipDraft.currentTimeSec,
    isDirty: state.clipDraft.isDirty,
  };
}

function createInlinePoseUndoSnapshot(
  state: PoseCreatorStoreState,
): PoseCreatorInlinePoseUndoSnapshot {
  return {
    boneDrafts: clonePoseCreatorBoneDrafts(state.boneDrafts),
    expressionDrafts: clonePoseCreatorExpressionDrafts(state.expressionDrafts),
    isDirty: state.clipInlineEdit?.isDirty ?? false,
    // Shapes are replaced, never mutated, so the snapshot can share them.
    ...(state.clipInlineEdit?.handShapes
      ? { handShapes: state.clipInlineEdit.handShapes }
      : {}),
  };
}

/** Restore FK/expression runtime state before React reads it on the Undo render. */
function reapplyPoseUndoSnapshotToAvatar(
  state: PoseCreatorStoreState,
  snapshot: PoseCreatorPoseUndoSnapshot | PoseCreatorInlinePoseUndoSnapshot,
): void {
  const avatar = state.activeAvatar;
  const vrm = avatar?.vrm;
  if (!avatar || !vrm) return;

  for (const [boneName, draft] of Object.entries(state.boneDrafts)) {
    vrm.humanoid
      .getNormalizedBoneNode(boneName as VRMHumanBoneName)
      ?.quaternion.copy(
        convertPoseQuaternionBasis(
          vrm,
          new Quaternion(...draft.baseQuaternion),
        ),
      );
  }
  for (const [boneName, draft] of Object.entries(snapshot.boneDrafts)) {
    vrm.humanoid
      .getNormalizedBoneNode(boneName as VRMHumanBoneName)
      ?.quaternion.copy(
        convertPoseQuaternionBasis(
          vrm,
          new Quaternion().setFromEuler(
            new Euler(
              MathUtils.degToRad(draft.rotationDegrees.x),
              MathUtils.degToRad(draft.rotationDegrees.y),
              MathUtils.degToRad(draft.rotationDegrees.z),
              "XYZ",
            ),
          ),
        ),
      );
  }

  for (const expressionName of Object.keys(state.expressionDrafts)) {
    avatar.clearExpressionOverride(expressionName);
  }
  for (const [expressionName, draft] of Object.entries(
    state.expressionDrafts,
  )) {
    if (!snapshot.expressionDrafts[expressionName]) {
      vrm.expressionManager?.setValue(expressionName, draft.baseValue);
    }
  }
  for (const [expressionName, draft] of Object.entries(
    snapshot.expressionDrafts,
  )) {
    avatar.setExpression(expressionName, draft.value);
  }
  vrm.update(0);
}

function arePoseUndoSnapshotsEqual(
  left: PoseCreatorPoseUndoSnapshot,
  right: PoseCreatorPoseUndoSnapshot,
): boolean {
  return (
    JSON.stringify(left.boneDrafts) === JSON.stringify(right.boneDrafts) &&
    JSON.stringify(left.expressionDrafts) ===
      JSON.stringify(right.expressionDrafts)
  );
}

function areClipUndoSnapshotsEqual(
  left: PoseCreatorClipUndoSnapshot,
  right: PoseCreatorClipUndoSnapshot,
): boolean {
  return (
    left.basePose === right.basePose &&
    JSON.stringify(left.keyframes) === JSON.stringify(right.keyframes) &&
    JSON.stringify(left.events) === JSON.stringify(right.events) &&
    // Pose edits can change the motion and leave the keyframe view as is.
    (left.motion === right.motion ||
      JSON.stringify(left.motion) === JSON.stringify(right.motion))
  );
}

function areInlinePoseUndoSnapshotsEqual(
  left: PoseCreatorInlinePoseUndoSnapshot,
  right: PoseCreatorInlinePoseUndoSnapshot,
): boolean {
  return (
    JSON.stringify(left.boneDrafts) === JSON.stringify(right.boneDrafts) &&
    JSON.stringify(left.expressionDrafts) ===
      JSON.stringify(right.expressionDrafts) &&
    JSON.stringify(left.handShapes ?? {}) ===
      JSON.stringify(right.handShapes ?? {})
  );
}

/** An inline edit carrying a snapshot's hand shapes (none when it has none). */
function withInlineHandShapes(
  edit: PoseCreatorClipInlineEditState,
  handShapes: PoseCreatorHandShapes | undefined,
): PoseCreatorClipInlineEditState {
  if (edit.handShapes === handShapes) return edit;
  const next = { ...edit };
  if (handShapes && Object.keys(handShapes).length > 0)
    next.handShapes = handShapes;
  else delete next.handShapes;
  return next;
}

function appendUndoSnapshot<T>(history: T[], snapshot: T): T[] {
  return [...history, snapshot].slice(-POSE_CREATOR_UNDO_HISTORY_LIMIT);
}

function rebasePoseHistory(
  history: PoseCreatorPoseUndoSnapshot[],
  savedSnapshot: PoseCreatorPoseUndoSnapshot,
): PoseCreatorPoseUndoSnapshot[] {
  return history.map((snapshot) => ({
    ...snapshot,
    isDirty: !arePoseUndoSnapshotsEqual(snapshot, savedSnapshot),
  }));
}

function rebaseClipHistory(
  history: PoseCreatorClipUndoSnapshot[],
  savedSnapshot: PoseCreatorClipUndoSnapshot,
): PoseCreatorClipUndoSnapshot[] {
  return history.map((snapshot) => ({
    ...snapshot,
    isDirty: !areClipUndoSnapshotsEqual(snapshot, savedSnapshot),
  }));
}

function recordPoseDraftUndo(
  state: PoseCreatorStoreState,
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
  /** The inline edit's next hand shapes (null: none); defaults to the current ones. */
  handShapes: PoseCreatorHandShapes | null = state.clipInlineEdit?.handShapes ??
    null,
): Partial<PoseCreatorStoreState> {
  // The outer interaction already owns the before-snapshot and compares it
  // once on commit. Avoid cloning/serializing every intermediate pointer move.
  const kind = state.clipInlineEdit ? "inline_pose" : "pose";
  if (state.undoGroup?.kind === kind) return {};

  const current = state.clipInlineEdit
    ? createInlinePoseUndoSnapshot(state)
    : createPoseUndoSnapshot(state);
  const next = {
    boneDrafts,
    expressionDrafts,
    isDirty: true,
    ...(handShapes ? { handShapes } : {}),
  };
  const unchanged = state.clipInlineEdit
    ? areInlinePoseUndoSnapshotsEqual(current, next)
    : arePoseUndoSnapshotsEqual(current, next);
  if (unchanged) return {};

  return state.clipInlineEdit
    ? {
        inlinePoseUndoHistory: appendUndoSnapshot(
          state.inlinePoseUndoHistory,
          current,
        ),
        inlinePoseRedoHistory: [],
      }
    : {
        poseUndoHistory: appendUndoSnapshot(state.poseUndoHistory, current),
        poseRedoHistory: [],
      };
}

function recordClipDraftUndo(
  state: PoseCreatorStoreState,
  nextDraft: PoseCreatorClipDraft,
): Partial<PoseCreatorStoreState> {
  const current = createClipUndoSnapshot(state);
  const next = createClipUndoSnapshot({
    ...state,
    clipDraft: nextDraft,
  });
  if (areClipUndoSnapshotsEqual(current, next)) return {};
  return state.undoGroup?.kind === "clip"
    ? {}
    : {
        clipUndoHistory: appendUndoSnapshot(state.clipUndoHistory, current),
        clipRedoHistory: [],
      };
}

function restoreClipUndoSnapshot(
  draft: PoseCreatorClipDraft,
  snapshot: PoseCreatorClipUndoSnapshot,
): PoseCreatorClipDraft {
  const keyframes = sortPoseCreatorClipKeyframes(
    snapshot.keyframes.map((keyframe) => ({ ...keyframe })),
  );
  const events = sortPoseCreatorClipEvents(
    snapshot.events.map((event) =>
      patchPoseCreatorClipEventDraft(
        clonePoseCreatorClipEvent(event),
        {
          time: event.time,
          ...(isAnimaPoseClipVFXEvent(event) && event.duration !== undefined
            ? { duration: event.duration }
            : {}),
        },
        draft.duration,
      ),
    ),
  );
  const selectedKeyframeId = keyframes.some(
    (keyframe) => keyframe.id === snapshot.selectedKeyframeId,
  )
    ? snapshot.selectedKeyframeId
    : null;
  const selectedEventId = events.some(
    (event) => event.id === snapshot.selectedEventId,
  )
    ? snapshot.selectedEventId
    : null;
  const selectedPoseAlias =
    snapshot.selectedPoseAlias &&
    keyframes.some((keyframe) => keyframe.pose === snapshot.selectedPoseAlias)
      ? snapshot.selectedPoseAlias
      : (keyframes.find((keyframe) => keyframe.id === selectedKeyframeId)
          ?.pose ?? null);

  return withPoseCreatorClipValidation(
    {
      ...draft,
      basePose: snapshot.basePose,
      motion: snapshot.motion,
      keyframes,
      events,
      selectedKeyframeId,
      selectedPoseAlias,
      selectedEventId,
      currentTimeSec: clampPoseCreatorClipTime(
        snapshot.currentTimeSec,
        draft.duration,
      ),
      isDirty: snapshot.isDirty,
    },
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
}

function markClipInlineEditDirty(
  edit: PoseCreatorClipInlineEditState | null,
): PoseCreatorClipInlineEditState | null {
  // Preserve workspace subscriptions while only the live pose values change.
  return edit && !edit.isDirty ? { ...edit, isDirty: true } : edit;
}

function areClipPreviewDiagnosticsEqual(
  left: PoseCreatorClipPreviewDiagnostics,
  right: PoseCreatorClipPreviewDiagnostics,
): boolean {
  return (
    areStringArraysEqual(left.missingPoseRefs, right.missingPoseRefs) &&
    areStringArraysEqual(left.missingAvatarVFXIds, right.missingAvatarVFXIds) &&
    areStringArraysEqual(
      left.missingSceneVFXPresetIds,
      right.missingSceneVFXPresetIds,
    ) &&
    areStringArraysEqual(
      left.missingParticleVFXIds,
      right.missingParticleVFXIds,
    ) &&
    areStringArraysEqual(left.missingSFXCueIds, right.missingSFXCueIds) &&
    areStringArraysEqual(left.eventAdapterWarnings, right.eventAdapterWarnings)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function resolveClipEditorTime(
  draft: PoseCreatorClipDraft,
  time: number,
  snapEnabled: boolean,
  snapIntervalSec: number,
): number {
  return snapEnabled
    ? snapPoseCreatorClipTime(time, draft.duration, snapIntervalSec)
    : clampPoseCreatorClipTime(time, draft.duration);
}

function getSelectedClipKeyframe(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipKeyframeDraft | null {
  return (
    draft.keyframes.find(
      (keyframe) => keyframe.id === draft.selectedKeyframeId,
    ) ?? null
  );
}

function getSelectedClipEvent(
  draft: PoseCreatorClipDraft,
): AnimaPoseClipEvent | null {
  return (
    draft.events.find((event) => event.id === draft.selectedEventId) ?? null
  );
}

function addClipEventsToDraft(
  draft: PoseCreatorClipDraft,
  events: readonly AnimaPoseClipEvent[],
  selectedEventId: string,
): PoseCreatorClipDraft {
  const selectedEvent =
    events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
  return withDirtyClipValidation({
    ...draft,
    events: sortPoseCreatorClipEvents([...draft.events, ...events]),
    selectedEventId: selectedEvent?.id ?? draft.selectedEventId,
    currentTimeSec: selectedEvent?.time ?? draft.currentTimeSec,
  });
}

function createDuplicatedClipEvent(
  draft: PoseCreatorClipDraft,
  event: AnimaPoseClipEvent,
): AnimaPoseClipEvent {
  return {
    ...clonePoseCreatorClipEvent(event),
    id: generatePoseCreatorClipEventId(draft.events.map((item) => item.id)),
  };
}

function findClipKeyframeStepTarget(
  draft: PoseCreatorClipDraft,
  direction: -1 | 1,
): PoseCreatorClipKeyframeDraft | null {
  const keyframes = sortPoseCreatorClipKeyframes(draft.keyframes);
  if (keyframes.length === 0) return null;

  if (direction > 0) {
    return (
      keyframes.find((keyframe) => keyframe.time > draft.currentTimeSec) ??
      keyframes[keyframes.length - 1]
    );
  }

  return (
    [...keyframes]
      .reverse()
      .find((keyframe) => keyframe.time < draft.currentTimeSec) ?? keyframes[0]
  );
}

export const usePoseCreatorStore = create<PoseCreatorStoreState>(
  (set, get) => ({
    ...resetTransientStateForSource(null),
    historyRequestRevision: 0,
    authoringMode: "pose",
    basePose: DEFAULT_POSE_CREATOR_BASE_POSE,
    boneHelperNodesVisible: true,
    poseUndoHistory: [],
    poseRedoHistory: [],
    clipUndoHistory: [],
    clipRedoHistory: [],
    inlinePoseUndoHistory: [],
    inlinePoseRedoHistory: [],
    undoGroup: null,
    setAuthoringMode: (authoringMode) =>
      set((state) => ({
        authoringMode,
        clipPlaybackPlaying: false,
        clipPlaybackAbsoluteTimeSec: state.clipDraft.currentTimeSec,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
      })),
    /** Capture one Pose history entry across a continuous or compound edit. */
    beginPoseUndoGroup: () =>
      set((state) => {
        if (state.undoGroup?.kind === "pose") {
          return {
            undoGroup: { ...state.undoGroup, depth: state.undoGroup.depth + 1 },
          };
        }
        if (state.undoGroup) return state;
        return {
          undoGroup: {
            kind: "pose",
            depth: 1,
            snapshot: createPoseUndoSnapshot(state),
          },
        };
      }),
    endPoseUndoGroup: () =>
      set((state) => {
        const group = state.undoGroup;
        if (group?.kind !== "pose") return state;
        if (group.depth > 1) {
          return { undoGroup: { ...group, depth: group.depth - 1 } };
        }
        const current = createPoseUndoSnapshot(state);
        return {
          undoGroup: null,
          ...(arePoseUndoSnapshotsEqual(group.snapshot, current)
            ? { isDirty: group.snapshot.isDirty }
            : {
                poseUndoHistory: appendUndoSnapshot(
                  state.poseUndoHistory,
                  group.snapshot,
                ),
                poseRedoHistory: [],
              }),
        };
      }),
    /** Route a Clip group to the document or active inline-pose sub-editor. */
    beginClipUndoGroup: () =>
      set((state) => {
        const kind = state.clipInlineEdit ? "inline_pose" : "clip";
        if (state.undoGroup?.kind === kind) {
          return {
            undoGroup: { ...state.undoGroup, depth: state.undoGroup.depth + 1 },
          };
        }
        if (state.undoGroup) return state;
        return {
          undoGroup:
            kind === "inline_pose"
              ? {
                  kind,
                  depth: 1,
                  snapshot: createInlinePoseUndoSnapshot(state),
                }
              : {
                  kind,
                  depth: 1,
                  snapshot: createClipUndoSnapshot(state),
                },
        };
      }),
    endClipUndoGroup: () =>
      set((state) => {
        const group = state.undoGroup;
        if (group?.kind !== "clip" && group?.kind !== "inline_pose") {
          return state;
        }
        if (group.depth > 1) {
          return { undoGroup: { ...group, depth: group.depth - 1 } };
        }
        if (group.kind === "inline_pose") {
          const current = createInlinePoseUndoSnapshot(state);
          return {
            undoGroup: null,
            ...(areInlinePoseUndoSnapshotsEqual(group.snapshot, current)
              ? {
                  clipInlineEdit: state.clipInlineEdit
                    ? {
                        ...state.clipInlineEdit,
                        isDirty: group.snapshot.isDirty,
                      }
                    : null,
                }
              : {
                  inlinePoseUndoHistory: appendUndoSnapshot(
                    state.inlinePoseUndoHistory,
                    group.snapshot,
                  ),
                  inlinePoseRedoHistory: [],
                }),
          };
        }
        const current = createClipUndoSnapshot(state);
        return {
          undoGroup: null,
          ...(areClipUndoSnapshotsEqual(group.snapshot, current)
            ? {}
            : {
                clipUndoHistory: appendUndoSnapshot(
                  state.clipUndoHistory,
                  group.snapshot,
                ),
                clipRedoHistory: [],
              }),
        };
      }),
    undoPose: () => {
      set((state) => ({
        historyRequestRevision: state.historyRequestRevision + 1,
      }));
      const state = get();
      if (state.undoGroup || state.poseUndoHistory.length === 0) return;
      const snapshot = state.poseUndoHistory.at(-1)!;
      const current = createPoseUndoSnapshot(state);
      reapplyPoseUndoSnapshotToAvatar(state, snapshot);
      set({
        poseUndoHistory: state.poseUndoHistory.slice(0, -1),
        poseRedoHistory: appendUndoSnapshot(state.poseRedoHistory, current),
        boneDrafts: clonePoseCreatorBoneDrafts(snapshot.boneDrafts),
        expressionDrafts: clonePoseCreatorExpressionDrafts(
          snapshot.expressionDrafts,
        ),
        isDirty: snapshot.isDirty,
        exportPreview: null,
        clipPlaybackPlaying: false,
      });
    },
    redoPose: () => {
      set((state) => ({
        historyRequestRevision: state.historyRequestRevision + 1,
      }));
      const state = get();
      if (state.undoGroup || state.poseRedoHistory.length === 0) return;
      const snapshot = state.poseRedoHistory.at(-1)!;
      const current = createPoseUndoSnapshot(state);
      reapplyPoseUndoSnapshotToAvatar(state, snapshot);
      set({
        poseUndoHistory: appendUndoSnapshot(state.poseUndoHistory, current),
        poseRedoHistory: state.poseRedoHistory.slice(0, -1),
        boneDrafts: clonePoseCreatorBoneDrafts(snapshot.boneDrafts),
        expressionDrafts: clonePoseCreatorExpressionDrafts(
          snapshot.expressionDrafts,
        ),
        isDirty: snapshot.isDirty,
        exportPreview: null,
        clipPlaybackPlaying: false,
      });
    },
    undoClip: () => {
      set((state) => ({
        historyRequestRevision: state.historyRequestRevision + 1,
      }));
      const state = get();
      if (state.undoGroup) return;
      if (state.clipInlineEdit) {
        const snapshot = state.inlinePoseUndoHistory.at(-1);
        if (!snapshot) return;
        const current = createInlinePoseUndoSnapshot(state);
        reapplyPoseUndoSnapshotToAvatar(state, snapshot);
        set({
          inlinePoseUndoHistory: state.inlinePoseUndoHistory.slice(0, -1),
          inlinePoseRedoHistory: appendUndoSnapshot(
            state.inlinePoseRedoHistory,
            current,
          ),
          boneDrafts: clonePoseCreatorBoneDrafts(snapshot.boneDrafts),
          expressionDrafts: clonePoseCreatorExpressionDrafts(
            snapshot.expressionDrafts,
          ),
          clipInlineEdit: withInlineHandShapes(
            { ...state.clipInlineEdit, isDirty: snapshot.isDirty },
            snapshot.handShapes,
          ),
          clipPlaybackPlaying: false,
          clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
        });
        return;
      }
      const snapshot = state.clipUndoHistory.at(-1);
      if (!snapshot) return;
      const current = createClipUndoSnapshot(state);
      const clipDraft = restoreClipUndoSnapshot(state.clipDraft, snapshot);
      set({
        clipUndoHistory: state.clipUndoHistory.slice(0, -1),
        clipRedoHistory: appendUndoSnapshot(state.clipRedoHistory, current),
        clipDraft,
        clipPlaybackPlaying: false,
        clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
      });
    },
    redoClip: () => {
      set((state) => ({
        historyRequestRevision: state.historyRequestRevision + 1,
      }));
      const state = get();
      if (state.undoGroup) return;
      if (state.clipInlineEdit) {
        const snapshot = state.inlinePoseRedoHistory.at(-1);
        if (!snapshot) return;
        const current = createInlinePoseUndoSnapshot(state);
        reapplyPoseUndoSnapshotToAvatar(state, snapshot);
        set({
          inlinePoseUndoHistory: appendUndoSnapshot(
            state.inlinePoseUndoHistory,
            current,
          ),
          inlinePoseRedoHistory: state.inlinePoseRedoHistory.slice(0, -1),
          boneDrafts: clonePoseCreatorBoneDrafts(snapshot.boneDrafts),
          expressionDrafts: clonePoseCreatorExpressionDrafts(
            snapshot.expressionDrafts,
          ),
          clipInlineEdit: withInlineHandShapes(
            { ...state.clipInlineEdit, isDirty: snapshot.isDirty },
            snapshot.handShapes,
          ),
          clipPlaybackPlaying: false,
          clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
        });
        return;
      }
      const snapshot = state.clipRedoHistory.at(-1);
      if (!snapshot) return;
      const current = createClipUndoSnapshot(state);
      const clipDraft = restoreClipUndoSnapshot(state.clipDraft, snapshot);
      set({
        clipUndoHistory: appendUndoSnapshot(state.clipUndoHistory, current),
        clipRedoHistory: state.clipRedoHistory.slice(0, -1),
        clipDraft,
        clipPlaybackPlaying: false,
        clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
      });
    },
    clearPoseUndoHistory: () =>
      set((state) =>
        state.poseUndoHistory.length === 0 &&
        state.poseRedoHistory.length === 0 &&
        state.undoGroup?.kind !== "pose"
          ? state
          : { poseUndoHistory: [], poseRedoHistory: [], undoGroup: null },
      ),
    clearClipUndoHistory: () =>
      set((state) =>
        state.clipUndoHistory.length === 0 &&
        state.clipRedoHistory.length === 0 &&
        state.inlinePoseUndoHistory.length === 0 &&
        state.inlinePoseRedoHistory.length === 0 &&
        state.undoGroup?.kind !== "clip" &&
        state.undoGroup?.kind !== "inline_pose"
          ? state
          : {
              clipUndoHistory: [],
              clipRedoHistory: [],
              inlinePoseUndoHistory: [],
              inlinePoseRedoHistory: [],
              undoGroup: null,
            },
      ),
    updateClipDraft: (patch) =>
      set((state) => {
        const applySettings = (draft: PoseCreatorClipDraft) => {
          // An end Base beat follows the duration, and Base beats take the
          // new base pose when it changes.
          const endBase = findPoseCreatorBaseBeat(draft, "end");
          let patched = patchPoseCreatorClipDraft(
            draft,
            patch,
            POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
          );
          if (endBase && patched.duration !== draft.duration) {
            const retimed = retimePoseCreatorBeat(
              patched,
              endBase.id,
              patched.duration,
              POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
            );
            // A duration edit keeps the selection and playhead.
            patched = {
              ...retimed,
              selectedKeyframeId: patched.selectedKeyframeId,
              selectedPoseAlias: patched.selectedPoseAlias,
              selectedEventId: patched.selectedEventId,
              currentTimeSec: patched.currentTimeSec,
            };
          }
          return patched.basePose !== draft.basePose
            ? reposePoseCreatorBaseBeats(
                patched,
                state.activeAvatar?.vrm ?? null,
                POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
              )
            : patched;
        };
        const clipDraft = applySettings(state.clipDraft);
        return {
          clipDraft,
          clipPlaybackPlaying: false,
          // Excluded settings are not undone, so older snapshots remain dirty.
          clipUndoHistory: state.clipUndoHistory.map((snapshot) => ({
            ...snapshot,
            ...createClipUndoSnapshot({
              clipDraft: applySettings({ ...state.clipDraft, ...snapshot }),
            }),
            isDirty: clipDraft.isDirty || snapshot.isDirty,
          })),
          clipRedoHistory: state.clipRedoHistory.map((snapshot) => ({
            ...snapshot,
            ...createClipUndoSnapshot({
              clipDraft: applySettings({ ...state.clipDraft, ...snapshot }),
            }),
            isDirty: clipDraft.isDirty || snapshot.isDirty,
          })),
        };
      }),
    resetClipDraft: (name) =>
      set((state) => {
        // A blank timeline has no sample for PreviewSync to apply, so clear the
        // last clip explicitly instead of leaving its face or humanoid pose
        // visible after New. applyPose replaces a prior T-pose or authored pose
        // with the neutral creator base even though an empty clip cannot play.
        state.activeAvatar?.applyPose(DEFAULT_POSE_CREATOR_BASE_POSE);
        state.activeAvatar?.clearAllExpressionOverrides();
        state.activeAvatar?.vrm?.update(0);
        return {
          ...resetPoseAuthoringState(),
          clipSessionToken: nextEditorSessionToken(),
          clipDraft: {
            ...createDefaultClipDraft(),
            ...(name ? { name } : {}),
          },
          clipInlineEdit: null,
          clipUndoHistory: [],
          clipRedoHistory: [],
          inlinePoseUndoHistory: [],
          inlinePoseRedoHistory: [],
          undoGroup: null,
          clipPreviewDiagnostics: createEmptyClipPreviewDiagnostics(),
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: 0,
          clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
        };
      }),
    hydrateClipDocument: (clip, options) => {
      try {
        const clipDraft = createPoseCreatorClipDraftFromAnimaPoseClip(clip, {
          ...POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
          fallbackBasePose:
            options?.fallbackBasePose ?? DEFAULT_POSE_CREATOR_BASE_POSE,
        });
        const hydratedDraft = {
          ...clipDraft,
          currentTimeSec: clampPoseCreatorClipTime(
            options?.currentTimeSec ?? clipDraft.currentTimeSec,
            clipDraft.duration,
          ),
        };
        set({
          ...resetPoseAuthoringState(hydratedDraft.basePose),
          authoringMode: "clip",
          clipSessionToken: nextEditorSessionToken(),
          clipDraft: withPoseCreatorClipValidation(
            { ...hydratedDraft, isDirty: false },
            POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
          ),
          clipInlineEdit: null,
          clipUndoHistory: [],
          clipRedoHistory: [],
          inlinePoseUndoHistory: [],
          inlinePoseRedoHistory: [],
          undoGroup: null,
          clipPreviewDiagnostics: createEmptyClipPreviewDiagnostics(),
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: hydratedDraft.currentTimeSec,
          importError: null,
        });
        return true;
      } catch {
        return false;
      }
    },
    markClipDocumentSaved: (name) =>
      set((state) => {
        const clipDraft = withPoseCreatorClipValidation(
          {
            ...state.clipDraft,
            name: name.trim() || state.clipDraft.name,
            isDirty: false,
          },
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        const savedSnapshot = createClipUndoSnapshot({
          ...state,
          clipDraft,
        });
        return {
          clipDraft,
          clipInlineEdit: null,
          inlinePoseUndoHistory: [],
          inlinePoseRedoHistory: [],
          undoGroup: null,
          clipUndoHistory: rebaseClipHistory(
            state.clipUndoHistory,
            savedSnapshot,
          ),
          clipRedoHistory: rebaseClipHistory(
            state.clipRedoHistory,
            savedSnapshot,
          ),
        };
      }),
    replaceClipDraftFromImport: (clipDraft) =>
      set({
        clipSessionToken: nextEditorSessionToken(),
        clipDraft: withPoseCreatorClipValidation(
          {
            ...clipDraft,
            isDirty: true,
          },
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        ),
        clipInlineEdit: null,
        clipUndoHistory: [],
        clipRedoHistory: [],
        inlinePoseUndoHistory: [],
        inlinePoseRedoHistory: [],
        undoGroup: null,
        clipPreviewDiagnostics: createEmptyClipPreviewDiagnostics(),
        clipPlaybackPlaying: false,
      }),
    setClipCurrentTime: (time, options) =>
      set((state) => {
        const nextTime = resolveClipEditorTime(
          state.clipDraft,
          time,
          options?.snap === true && state.clipSnapEnabled,
          state.clipSnapIntervalSec,
        );
        return {
          clipDraft: withPoseCreatorClipValidation(
            {
              ...state.clipDraft,
              currentTimeSec: nextTime,
            },
            POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
          ),
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
        };
      }),
    setClipSnapEnabled: (clipSnapEnabled) => set({ clipSnapEnabled }),
    setClipSnapInterval: (clipSnapIntervalSec) =>
      set({
        clipSnapIntervalSec:
          normalizePoseCreatorClipSnapInterval(clipSnapIntervalSec),
      }),
    setClipPreviewDiagnostics: (diagnostics) =>
      set((state) => {
        const nextDiagnostics = {
          missingPoseRefs: [...diagnostics.missingPoseRefs],
          missingAvatarVFXIds: [...diagnostics.missingAvatarVFXIds],
          missingSceneVFXPresetIds: [...diagnostics.missingSceneVFXPresetIds],
          missingParticleVFXIds: [...diagnostics.missingParticleVFXIds],
          missingSFXCueIds: [...diagnostics.missingSFXCueIds],
          eventAdapterWarnings: [...diagnostics.eventAdapterWarnings],
        };
        if (
          areClipPreviewDiagnosticsEqual(
            state.clipPreviewDiagnostics,
            nextDiagnostics,
          )
        ) {
          return state;
        }
        return {
          clipPreviewDiagnostics: nextDiagnostics,
        };
      }),
    playClipPreview: () =>
      set((state) => {
        if (
          state.clipDraft.duration <= 0 ||
          (state.clipDraft.keyframes.length === 0 &&
            state.clipDraft.events.length === 0)
        ) {
          return state;
        }
        const currentTime =
          !state.clipDraft.loop &&
          state.clipDraft.currentTimeSec >= state.clipDraft.duration
            ? 0
            : state.clipDraft.currentTimeSec;
        return {
          clipPlaybackPlaying: true,
          clipPlaybackAbsoluteTimeSec: currentTime,
          clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
          clipDraft: {
            ...state.clipDraft,
            currentTimeSec: clampPoseCreatorClipTime(
              currentTime,
              state.clipDraft.duration,
            ),
          },
        };
      }),
    pauseClipPreview: () =>
      set((state) => ({
        clipPlaybackPlaying: false,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
      })),
    stopClipPreview: () =>
      set((state) => ({
        clipPlaybackPlaying: false,
        clipPlaybackAbsoluteTimeSec: 0,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
        clipDraft: {
          ...state.clipDraft,
          currentTimeSec: 0,
        },
      })),
    restartClipPreview: () =>
      set((state) => ({
        clipPlaybackPlaying:
          state.clipDraft.duration > 0 &&
          (state.clipDraft.keyframes.length > 0 ||
            state.clipDraft.events.length > 0),
        clipPlaybackAbsoluteTimeSec: 0,
        clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
        clipDraft: {
          ...state.clipDraft,
          currentTimeSec: 0,
        },
      })),
    setClipPlaybackSpeed: (clipPlaybackSpeed) =>
      set({
        clipPlaybackSpeed:
          normalizePoseCreatorClipPlaybackSpeed(clipPlaybackSpeed),
      }),
    advanceClipPlayback: (deltaSeconds) =>
      set((state) => {
        if (!state.clipPlaybackPlaying) return state;
        const duration = Math.max(0, state.clipDraft.duration);
        if (duration <= 0 || !Number.isFinite(deltaSeconds)) {
          return { clipPlaybackPlaying: false };
        }

        const elapsed = Math.max(0, deltaSeconds) * state.clipPlaybackSpeed;
        const nextTime = state.clipDraft.currentTimeSec + elapsed;
        const nextAbsoluteTime = state.clipPlaybackAbsoluteTimeSec + elapsed;
        if (state.clipDraft.loop) {
          const loopedTime = ((nextTime % duration) + duration) % duration;
          return {
            clipPlaybackAbsoluteTimeSec: nextAbsoluteTime,
            clipDraft: {
              ...state.clipDraft,
              currentTimeSec: clampPoseCreatorClipTime(loopedTime, duration),
            },
          };
        }

        if (nextTime >= duration) {
          return {
            clipPlaybackPlaying: false,
            clipPlaybackAbsoluteTimeSec: duration,
            clipPreviewClearRevision: state.clipPreviewClearRevision + 1,
            clipPlaybackCompletedRevision:
              state.clipPlaybackCompletedRevision + 1,
            clipDraft: {
              ...state.clipDraft,
              currentTimeSec: duration,
            },
          };
        }

        return {
          clipPlaybackAbsoluteTimeSec: nextAbsoluteTime,
          clipDraft: {
            ...state.clipDraft,
            currentTimeSec: clampPoseCreatorClipTime(nextTime, duration),
          },
        };
      }),
    stepClipTime: (direction) =>
      set((state) => {
        const nextTime = clampPoseCreatorClipTime(
          state.clipDraft.currentTimeSec +
            POSE_CREATOR_CLIP_FRAME_STEP_SEC * direction,
          state.clipDraft.duration,
        );
        return {
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
          clipDraft: {
            ...state.clipDraft,
            currentTimeSec: nextTime,
          },
        };
      }),
    stepClipKeyframe: (direction) =>
      set((state) => {
        const keyframe = findClipKeyframeStepTarget(state.clipDraft, direction);
        if (!keyframe) {
          return { clipPlaybackPlaying: false };
        }

        return {
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: keyframe.time,
          clipDraft: {
            ...state.clipDraft,
            selectedKeyframeId: keyframe.id,
            selectedEventId: null,
            selectedPoseAlias: keyframe.pose,
            currentTimeSec: keyframe.time,
          },
        };
      }),
    selectClipKeyframe: (selectedKeyframeId) =>
      set((state) => {
        const selectedKeyframe =
          selectedKeyframeId === null
            ? null
            : (state.clipDraft.keyframes.find(
                (keyframe) => keyframe.id === selectedKeyframeId,
              ) ?? null);
        const nextTime = selectedKeyframe
          ? selectedKeyframe.time
          : state.clipDraft.currentTimeSec;
        return {
          clipDraft: {
            ...state.clipDraft,
            selectedKeyframeId: selectedKeyframe?.id ?? null,
            selectedEventId: selectedKeyframe
              ? null
              : state.clipDraft.selectedEventId,
            selectedPoseAlias:
              selectedKeyframe?.pose ?? state.clipDraft.selectedPoseAlias,
            currentTimeSec: nextTime,
          },
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
        };
      }),
    selectClipEvent: (selectedEventId) =>
      set((state) => {
        const selectedEvent =
          selectedEventId === null
            ? null
            : (state.clipDraft.events.find(
                (event) => event.id === selectedEventId,
              ) ?? null);
        const nextTime = selectedEvent
          ? selectedEvent.time
          : state.clipDraft.currentTimeSec;
        return {
          clipDraft: {
            ...state.clipDraft,
            selectedEventId: selectedEvent?.id ?? null,
            selectedKeyframeId: selectedEvent
              ? null
              : state.clipDraft.selectedKeyframeId,
            currentTimeSec: nextTime,
          },
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
        };
      }),
    insertClipAvatarVFXEventAtPlayhead: (effectId, options) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const event = createPoseCreatorClipAvatarVFXEventDraft(
          state.clipDraft,
          effectId,
          state.clipDraft.currentTimeSec,
        );
        const events: AnimaPoseClipEvent[] = [event];
        if (options?.linkedSfxCueId) {
          const linkedDraft = {
            ...state.clipDraft,
            events: [...state.clipDraft.events, event],
          };
          events.push(
            createPoseCreatorClipSFXEventDraft(
              linkedDraft,
              options.linkedSfxCueId,
              event.time,
            ),
          );
        }
        const clipDraft = addClipEventsToDraft(
          state.clipDraft,
          events,
          event.id,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    insertClipSceneVFXEventAtPlayhead: (sceneKind, presetId) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const event = createPoseCreatorClipSceneVFXEventDraft(
          state.clipDraft,
          sceneKind,
          presetId,
          state.clipDraft.currentTimeSec,
        );
        const clipDraft = addClipEventsToDraft(
          state.clipDraft,
          [event],
          event.id,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    insertClipParticleVFXEventAtPlayhead: (effectId, catalogEntry) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const event = createPoseCreatorClipParticleVFXEventDraft(
          state.clipDraft,
          effectId,
          state.clipDraft.currentTimeSec,
          catalogEntry,
        );
        const clipDraft = addClipEventsToDraft(
          state.clipDraft,
          [event],
          event.id,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    insertClipSFXEventAtPlayhead: (cueId) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const event = createPoseCreatorClipSFXEventDraft(
          state.clipDraft,
          cueId,
          state.clipDraft.currentTimeSec,
        );
        const clipDraft = addClipEventsToDraft(
          state.clipDraft,
          [event],
          event.id,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    beginClipInlinePoseEdit: (input) =>
      set((state) => ({
        clipInlineEdit: {
          alias: input.alias,
          keyframeId: input.keyframeId,
          originalPose: structuredClone(input.originalPose),
          previousBoneDrafts: clonePoseCreatorBoneDrafts(state.boneDrafts),
          previousExpressionDrafts: clonePoseCreatorExpressionDrafts(
            state.expressionDrafts,
          ),
          previousDraftName: state.draftName,
          previousIsDirty: state.isDirty,
          isDirty: false,
        },
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        boneDrafts: clonePoseCreatorBoneDrafts(input.boneDrafts),
        expressionDrafts: clonePoseCreatorExpressionDrafts(
          input.expressionDrafts,
        ),
        inlinePoseUndoHistory: [],
        inlinePoseRedoHistory: [],
        undoGroup: null,
        draftName: input.draftName,
        exportPreview: null,
        clipPlaybackPlaying: false,
      })),
    commitClipInlinePoseEdit: (pose) =>
      set((state) => {
        const edit = state.clipInlineEdit;
        if (!edit) return state;
        const parsed = parseAnimaPose(pose);
        const clipDraft = edit.keyframeId
          ? setPoseCreatorBeatPose(
              state.clipDraft,
              edit.keyframeId,
              {
                humanoid: parsed.humanoid,
                expressions: parsed.expressions,
                complete: true,
                // The edit started from the pose the Avatar plays, solved
                // arms included; solved arms keep only the edit's change.
                relativeToPlayback: true,
                ...(edit.handShapes ? { hands: edit.handShapes } : {}),
              },
              state.activeAvatar?.vrm ?? null,
              POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
            )
          : state.clipDraft;
        const historyState = recordClipDraftUndo(
          { ...state, undoGroup: null },
          clipDraft,
        );
        return {
          ...historyState,
          clipDraft,
          clipInlineEdit: null,
          inlinePoseUndoHistory: [],
          inlinePoseRedoHistory: [],
          undoGroup: null,
          selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
          selectedBoneFocusRequest: null,
          boneDrafts: clonePoseCreatorBoneDrafts(edit.previousBoneDrafts),
          expressionDrafts: clonePoseCreatorExpressionDrafts(
            edit.previousExpressionDrafts,
          ),
          draftName: edit.previousDraftName,
          isDirty: edit.previousIsDirty,
          exportPreview: null,
          clipPlaybackPlaying: false,
        };
      }),
    cancelClipInlinePoseEdit: () =>
      set((state) => {
        const edit = state.clipInlineEdit;
        if (!edit) return state;

        return {
          // The beat was never changed during the edit; nothing to restore.
          clipInlineEdit: null,
          inlinePoseUndoHistory: [],
          inlinePoseRedoHistory: [],
          undoGroup: null,
          selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
          selectedBoneFocusRequest: null,
          boneDrafts: clonePoseCreatorBoneDrafts(edit.previousBoneDrafts),
          expressionDrafts: clonePoseCreatorExpressionDrafts(
            edit.previousExpressionDrafts,
          ),
          draftName: edit.previousDraftName,
          isDirty: edit.previousIsDirty,
          exportPreview: null,
          clipPlaybackPlaying: false,
        };
      }),
    captureClipPoseAtPlayhead: () =>
      set((state) => {
        // A captured beat pins the motion where it is.
        const clipDraft = insertPoseCreatorBeat(
          state.clipDraft,
          { timeSec: state.clipDraft.currentTimeSec, label: "Captured" },
          state.activeAvatar?.vrm ?? null,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    addPoseToClip: (pose, label, options = {}) => {
      const state = get();
      try {
        const resolved = resolveAnimaPose(
          parseAnimaPose(pose),
          getResolvedAvatarPose,
        );
        const clipDraft = insertPoseCreatorLibraryPose(
          state.clipDraft,
          {
            timeSec: options.timeSec ?? state.clipDraft.currentTimeSec,
            label,
            // By value: the Pose's bones and expressions are keyed, and
            // those it omits take the base pose and 0.
            pose: {
              humanoid: resolved.humanoid,
              expressions: resolved.expressions,
              complete: true,
              keyAll: true,
            },
          },
          state.activeAvatar?.vrm ?? null,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        // An unresolvable base pose rejects the whole insertion.
        if (!clipDraft) return null;
        set({
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
        });
        return clipDraft.selectedPoseAlias;
      } catch {
        // Missing/malformed parents reject the whole insertion, including history.
        return null;
      }
    },
    setClipExpressionsAtPlayhead: (expressions) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const clipDraft = setPoseCreatorBeatExpressionsAtTime(
          state.clipDraft,
          expressions,
          state.activeAvatar?.vrm ?? null,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    updateSelectedClipKeyframe: (patch) =>
      set((state) => {
        const selectedKeyframe = getSelectedClipKeyframe(state.clipDraft);
        if (!selectedKeyframe) return state;

        const options = POSE_CREATOR_CLIP_VALIDATION_OPTIONS;
        let clipDraft = state.clipDraft;
        if (patch.label !== undefined)
          clipDraft = setPoseCreatorBeatLabel(
            clipDraft,
            selectedKeyframe.id,
            patch.label,
            options,
          );
        if (patch.ease !== undefined)
          clipDraft = setPoseCreatorBeatEase(
            clipDraft,
            selectedKeyframe.id,
            patch.ease ?? undefined,
            options,
          );
        if (patch.time !== undefined)
          clipDraft = retimePoseCreatorBeat(
            clipDraft,
            selectedKeyframe.id,
            patch.time,
            options,
          );
        if (clipDraft === state.clipDraft) return state;
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
        };
      }),
    updateSelectedClipEvent: (patch) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const selectedEvent = getSelectedClipEvent(state.clipDraft);
        if (!selectedEvent) return state;

        const events = state.clipDraft.events.map((event) =>
          event.id === selectedEvent.id
            ? patchPoseCreatorClipEventDraft(
                event,
                patch,
                state.clipDraft.duration,
              )
            : event,
        );
        const nextSelectedEvent =
          events.find((event) => event.id === selectedEvent.id) ??
          selectedEvent;

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          events: sortPoseCreatorClipEvents(events),
          currentTimeSec: nextSelectedEvent.time,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextSelectedEvent.time,
        };
      }),
    moveClipKeyframe: (keyframeId, time, options) =>
      set((state) => {
        const keyframe = state.clipDraft.keyframes.find(
          (candidate) => candidate.id === keyframeId,
        );
        if (!keyframe) return state;

        const nextTime = resolveClipEditorTime(
          state.clipDraft,
          time,
          options?.snap === true && state.clipSnapEnabled,
          state.clipSnapIntervalSec,
        );
        const clipDraft = retimePoseCreatorBeat(
          state.clipDraft,
          keyframe.id,
          nextTime,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
        };
      }),
    moveClipEvent: (eventId, time, options) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const event = state.clipDraft.events.find(
          (candidate) => candidate.id === eventId,
        );
        if (!event) return state;

        const nextTime = resolveClipEditorTime(
          state.clipDraft,
          time,
          options?.snap === true && state.clipSnapEnabled,
          state.clipSnapIntervalSec,
        );
        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          events: sortPoseCreatorClipEvents(
            state.clipDraft.events.map((candidate) =>
              candidate.id === event.id
                ? patchPoseCreatorClipEventDraft(
                    candidate,
                    { time: nextTime },
                    state.clipDraft.duration,
                  )
                : candidate,
            ),
          ),
          selectedEventId: event.id,
          currentTimeSec: nextTime,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
        };
      }),
    deleteSelectedClipKeyframe: () =>
      set((state) => {
        const selectedKeyframe = getSelectedClipKeyframe(state.clipDraft);
        if (!selectedKeyframe) return state;
        const clipDraft = deletePoseCreatorBeat(
          state.clipDraft,
          selectedKeyframe.id,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec,
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    deleteSelectedClipEvent: () =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const selectedEvent = getSelectedClipEvent(state.clipDraft);
        if (!selectedEvent) return state;

        const selectedIndex = state.clipDraft.events.findIndex(
          (event) => event.id === selectedEvent.id,
        );
        const events = state.clipDraft.events.filter(
          (event) => event.id !== selectedEvent.id,
        );
        const nextSelectedEvent =
          events[Math.min(selectedIndex, events.length - 1)] ??
          events[selectedIndex - 1] ??
          null;

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          events,
          selectedEventId: nextSelectedEvent?.id ?? null,
          currentTimeSec:
            nextSelectedEvent?.time ?? state.clipDraft.currentTimeSec,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipPlaybackAbsoluteTimeSec:
            nextSelectedEvent?.time ?? state.clipDraft.currentTimeSec,
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    duplicateSelectedClipEvent: () =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const selectedEvent = getSelectedClipEvent(state.clipDraft);
        if (!selectedEvent) return state;

        const event = createDuplicatedClipEvent(state.clipDraft, selectedEvent);
        const clipDraft = addClipEventsToDraft(
          state.clipDraft,
          [event],
          event.id,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    nudgeSelectedClipEvent: (direction) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const selectedEvent = getSelectedClipEvent(state.clipDraft);
        if (!selectedEvent) return { clipPlaybackPlaying: false };
        const nextTime = clampPoseCreatorClipTime(
          selectedEvent.time + state.clipSnapIntervalSec * direction,
          state.clipDraft.duration,
        );

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          events: sortPoseCreatorClipEvents(
            state.clipDraft.events.map((event) =>
              event.id === selectedEvent.id
                ? patchPoseCreatorClipEventDraft(
                    event,
                    { time: nextTime },
                    state.clipDraft.duration,
                  )
                : event,
            ),
          ),
          selectedEventId: selectedEvent.id,
          currentTimeSec: nextTime,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
        };
      }),
    clearClipEvents: (kind) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const events =
          kind === undefined
            ? []
            : state.clipDraft.events.filter((event) => event.kind !== kind);
        if (events.length === state.clipDraft.events.length) return state;
        const selectedEventStillExists = events.some(
          (event) => event.id === state.clipDraft.selectedEventId,
        );
        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          events,
          selectedEventId: selectedEventStillExists
            ? state.clipDraft.selectedEventId
            : null,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    setClipBaseEndpoint: (endpoint, enabled) =>
      set((state) => {
        if (state.clipInlineEdit || state.clipDraft.duration <= 0) return state;
        const clipDraft = setPoseCreatorBaseBeat(
          state.clipDraft,
          endpoint,
          enabled,
          state.activeAvatar?.vrm ?? null,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        if (clipDraft === state.clipDraft) return state;
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    setModelSource: (selectedSource) =>
      set({
        selectedSource,
        activeAvatar: null,
        loadStatus: selectedSource ? "idle" : "error",
        loadError: selectedSource ? null : "Select an Avatar Model to preview.",
        loadProgress: null,
      }),
    setBasePose: (basePose) =>
      set((state) => ({
        basePose,
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        boneDrafts: {},
        poseUndoHistory: [],
        poseRedoHistory: [],
        undoGroup: null,
        exportPreview: null,
        isDirty:
          hasDrafts({}, state.expressionDrafts) || hasCurrentSavedDraft(state),
      })),
    setActiveAvatar: (activeAvatar) => set({ activeAvatar }),
    setLoadStatus: (loadStatus, loadError = null) =>
      set({
        loadStatus,
        loadError: loadStatus === "error" ? loadError : null,
      }),
    setLoadProgress: (loadProgress) => set({ loadProgress }),
    setSelectedBone: (selectedBone) => set({ selectedBone }),
    focusBone: (boneName) =>
      set((state) => ({
        selectedBone: boneName,
        selectedBoneFocusRequest: {
          boneName,
          requestId: (state.selectedBoneFocusRequest?.requestId ?? 0) + 1,
        },
      })),
    setBoneHelperNodesVisible: (boneHelperNodesVisible) =>
      set({ boneHelperNodesVisible }),
    setMirrorOppositeBone: (mirrorOppositeBone) => set({ mirrorOppositeBone }),
    /** Validate the whole operation before publishing one draft/history transition. */
    setBoneDraftBatch: (updates, handShapes) => {
      for (const [name, draft] of Object.entries(updates)) {
        if (!(VRMHumanBoneList as string[]).includes(name)) return false;
        if (!draft) continue;
        if (
          draft.baseQuaternion.length !== 4 ||
          !draft.baseQuaternion.every(Number.isFinite) ||
          draft.baseQuaternion.reduce((sum, value) => sum + value * value, 0) <
            1e-12 ||
          ![
            draft.rotationDegrees.x,
            draft.rotationDegrees.y,
            draft.rotationDegrees.z,
          ].every(Number.isFinite) ||
          (draft.position &&
            (draft.position.length !== 3 ||
              !draft.position.every(Number.isFinite)))
        )
          return false;
      }
      set((state) => {
        const boneDrafts = { ...state.boneDrafts };
        for (const [name, draft] of Object.entries(updates)) {
          if (draft)
            boneDrafts[name] = clonePoseCreatorBoneDrafts({ [name]: draft })[
              name
            ];
          else delete boneDrafts[name];
        }
        const edit = state.clipInlineEdit;
        let nextHandShapes = edit?.handShapes;
        if (edit && handShapes) {
          const shapes: PoseCreatorHandShapes = { ...edit.handShapes };
          for (const [side, shape] of Object.entries(handShapes)) {
            if (shape) shapes[side as HandSide] = shape;
            else delete shapes[side as HandSide];
          }
          nextHandShapes = Object.keys(shapes).length > 0 ? shapes : undefined;
        }
        const handShapesChanged =
          JSON.stringify(nextHandShapes ?? {}) !==
          JSON.stringify(edit?.handShapes ?? {});
        if (
          JSON.stringify(boneDrafts) === JSON.stringify(state.boneDrafts) &&
          !handShapesChanged
        )
          return state;
        return {
          ...recordPoseDraftUndo(
            state,
            boneDrafts,
            state.expressionDrafts,
            nextHandShapes ?? null,
          ),
          boneDrafts,
          clipInlineEdit:
            edit && handShapesChanged
              ? withInlineHandShapes({ ...edit, isDirty: true }, nextHandShapes)
              : markClipInlineEditDirty(edit),
          clipPlaybackPlaying: false,
          isDirty: state.clipInlineEdit
            ? state.isDirty
            : getDirtyStateAfterDraftMutation(
                state,
                boneDrafts,
                state.expressionDrafts,
              ),
        };
      });
      return true;
    },
    setBoneDraft: (boneName, draft) =>
      set((state) => {
        const boneDrafts = {
          ...state.boneDrafts,
          [boneName]: draft,
        };
        return {
          ...recordPoseDraftUndo(state, boneDrafts, state.expressionDrafts),
          boneDrafts,
          clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
          clipPlaybackPlaying: false,
          isDirty: state.clipInlineEdit
            ? state.isDirty
            : getDirtyStateAfterDraftMutation(
                state,
                boneDrafts,
                state.expressionDrafts,
              ),
        };
      }),
    removeBoneDraft: (boneName) =>
      set((state) => {
        if (!(boneName in state.boneDrafts)) return state;
        const boneDrafts = { ...state.boneDrafts };
        delete boneDrafts[boneName];
        return {
          ...recordPoseDraftUndo(state, boneDrafts, state.expressionDrafts),
          boneDrafts,
          clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
          clipPlaybackPlaying: false,
          isDirty: state.clipInlineEdit
            ? state.isDirty
            : getDirtyStateAfterDraftMutation(
                state,
                boneDrafts,
                state.expressionDrafts,
              ),
        };
      }),
    clearBoneDrafts: () =>
      set((state) => ({
        // Resetting every bone also forgets the Hands tool's shapes.
        ...recordPoseDraftUndo(state, {}, state.expressionDrafts, null),
        boneDrafts: {},
        clipInlineEdit: state.clipInlineEdit?.handShapes
          ? withInlineHandShapes(
              { ...state.clipInlineEdit, isDirty: true },
              undefined,
            )
          : markClipInlineEditDirty(state.clipInlineEdit),
        clipPlaybackPlaying: false,
        isDirty: state.clipInlineEdit
          ? state.isDirty
          : getDirtyStateAfterDraftMutation(state, {}, state.expressionDrafts),
      })),
    setExpressionDraft: (expressionName, draft) =>
      set((state) => {
        const expressionDrafts = {
          ...state.expressionDrafts,
          [expressionName]: draft,
        };
        return {
          ...recordPoseDraftUndo(state, state.boneDrafts, expressionDrafts),
          expressionDrafts,
          clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
          clipPlaybackPlaying: false,
          isDirty: state.clipInlineEdit
            ? state.isDirty
            : getDirtyStateAfterDraftMutation(
                state,
                state.boneDrafts,
                expressionDrafts,
              ),
        };
      }),
    removeExpressionDraft: (expressionName) =>
      set((state) => {
        if (!(expressionName in state.expressionDrafts)) return state;
        const expressionDrafts = { ...state.expressionDrafts };
        delete expressionDrafts[expressionName];
        return {
          ...recordPoseDraftUndo(state, state.boneDrafts, expressionDrafts),
          expressionDrafts,
          clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
          clipPlaybackPlaying: false,
          isDirty: state.clipInlineEdit
            ? state.isDirty
            : getDirtyStateAfterDraftMutation(
                state,
                state.boneDrafts,
                expressionDrafts,
              ),
        };
      }),
    clearExpressionDrafts: () =>
      set((state) => ({
        ...recordPoseDraftUndo(state, state.boneDrafts, {}),
        expressionDrafts: {},
        clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
        clipPlaybackPlaying: false,
        isDirty: state.clipInlineEdit
          ? state.isDirty
          : getDirtyStateAfterDraftMutation(state, state.boneDrafts, {}),
      })),
    setDirty: (isDirty) => set({ isDirty }),
    setExportPreview: (exportPreview) => set({ exportPreview }),
    setDraftName: (draftName) =>
      set((state) => {
        const trimmedName = draftName.trim();
        const isDirty =
          state.isDirty ||
          (state.savedPoseIdentity
            ? trimmedName !== state.savedPoseIdentity.name
            : trimmedName.length > 0);
        return {
          draftName,
          isDirty,
          poseUndoHistory: state.poseUndoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: isDirty || snapshot.isDirty,
          })),
          poseRedoHistory: state.poseRedoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: isDirty || snapshot.isDirty,
          })),
        };
      }),
    setImportError: (importError) => set({ importError }),
    loadPoseDocument: (identity, replacement) =>
      set({
        ...capturePoseCreatorSubmittedDraft(replacement),
        savedPoseIdentity: identity ? { ...identity } : null,
        poseSessionToken: nextEditorSessionToken(),
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        isDirty: identity === null,
        poseUndoHistory: [],
        poseRedoHistory: [],
        undoGroup: null,
        exportPreview: null,
        importError: null,
      }),
    acknowledgePoseSave: ({ sessionToken, submittedDraft, savedIdentity }) => {
      const state = get();
      if (state.poseSessionToken !== sessionToken) return false;
      const matches =
        JSON.stringify(capturePoseCreatorSubmittedDraft(state)) ===
        JSON.stringify(submittedDraft);
      const metadataChanged =
        state.basePose !== submittedDraft.basePose ||
        state.draftName !== submittedDraft.draftName;
      const savedSnapshot = {
        boneDrafts: submittedDraft.boneDrafts,
        expressionDrafts: submittedDraft.expressionDrafts,
        isDirty: false,
      };
      const rebase = (history: PoseCreatorPoseUndoSnapshot[]) =>
        rebasePoseHistory(history, savedSnapshot).map((snapshot) => ({
          ...snapshot,
          isDirty: metadataChanged || snapshot.isDirty,
        }));
      set({
        savedPoseIdentity: { ...savedIdentity },
        ...(matches ? { draftName: savedIdentity.name } : {}),
        isDirty: !matches,
        importError: null,
        poseUndoHistory: rebase(state.poseUndoHistory),
        poseRedoHistory: rebase(state.poseRedoHistory),
      });
      return true;
    },
    replaceDraftFromImport: (replacement) =>
      set({
        ...replacement,
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        savedPoseIdentity: null,
        poseSessionToken: nextEditorSessionToken(),
        isDirty: true,
        poseUndoHistory: [],
        poseRedoHistory: [],
        undoGroup: null,
        exportPreview: null,
        importError: replacement.importError ?? null,
      }),
    startNewPose: () => set(resetPoseAuthoringState()),
    resetWorkspace: () =>
      set({
        ...resetTransientStateForSource(null),
        basePose: DEFAULT_POSE_CREATOR_BASE_POSE,
        poseUndoHistory: [],
        poseRedoHistory: [],
        clipUndoHistory: [],
        clipRedoHistory: [],
        inlinePoseUndoHistory: [],
        inlinePoseRedoHistory: [],
        undoGroup: null,
      }),
  }),
);

// Clip issues are worded when validated, so a UI Locale change validates the
// clip again. The entrypoints create i18n before this module loads.
getI18n().on("languageChanged", () =>
  usePoseCreatorStore.setState((state) => ({
    clipDraft: withPoseCreatorClipValidation(
      state.clipDraft,
      POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
    ),
  })),
);

/** Pose Undo is unavailable while a grouped interaction is still active. */
export function selectCanUndoPose(
  state: ReturnType<typeof usePoseCreatorStore.getState>,
): boolean {
  return state.undoGroup === null && state.poseUndoHistory.length > 0;
}

export function selectCanRedoPose(
  state: ReturnType<typeof usePoseCreatorStore.getState>,
): boolean {
  return state.undoGroup === null && state.poseRedoHistory.length > 0;
}

/** Clip inline-pose edits use their own history until Commit or Cancel. */
export function selectCanUndoClip(
  state: ReturnType<typeof usePoseCreatorStore.getState>,
): boolean {
  if (state.undoGroup !== null) return false;
  return state.clipInlineEdit
    ? state.inlinePoseUndoHistory.length > 0
    : state.clipUndoHistory.length > 0;
}

export function selectCanRedoClip(
  state: ReturnType<typeof usePoseCreatorStore.getState>,
): boolean {
  if (state.undoGroup !== null) return false;
  return state.clipInlineEdit
    ? state.inlinePoseRedoHistory.length > 0
    : state.clipRedoHistory.length > 0;
}

/** Capture immutable Save values before an asynchronous request begins. */
export function capturePoseCreatorSubmittedDraft(
  state: PoseCreatorSubmittedDraft,
): PoseCreatorSubmittedDraft {
  return {
    draftName: state.draftName,
    basePose: state.basePose,
    boneDrafts: clonePoseCreatorBoneDrafts(state.boneDrafts),
    expressionDrafts: clonePoseCreatorExpressionDrafts(state.expressionDrafts),
  };
}
