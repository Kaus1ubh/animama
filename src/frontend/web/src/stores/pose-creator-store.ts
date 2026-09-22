"use client";

import type { VRMHumanBoneName } from "@pixiv/three-vrm";
import { Euler, MathUtils } from "three";
import { create } from "zustand";

import {
  isAnimaPoseClipRef,
  isAnimaPoseClipVFXEvent,
  type AnimaPoseClip,
  type AnimaPoseClipEvent,
  type AnimaPoseClipPose,
  type AnimaPoseClipSceneVFXKind,
  type Avatar,
  type AvatarLoadProgress,
  type ParticleVFXCatalogEntry,
} from "@/lib/avatar";
import {
  cloneAnimaPose,
  parseAnimaPose,
  type AnimaPose,
} from "@/lib/avatar/poses/animaPose";
import {
  AVATAR_POSE_IDS,
  RELAXED_REST_POSE_ID,
  getAvatarPose,
  getResolvedAvatarPose,
} from "@/lib/avatar/poses/catalog";
import {
  clonePoseCreatorClipPose,
  clonePoseCreatorClipTransition,
  clampPoseCreatorClipDuration,
  clampPoseCreatorClipTime,
  clonePoseCreatorClipEvent,
  createDefaultPoseCreatorClipDraft,
  createPoseCreatorClipAvatarVFXEventDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  createPoseCreatorClipInlinePose,
  createPoseCreatorClipKeyframeDraft,
  createPoseCreatorClipParticleVFXEventDraft,
  createPoseCreatorClipRefPose,
  createPoseCreatorClipSceneVFXEventDraft,
  createPoseCreatorClipSFXEventDraft,
  findPoseCreatorClipKeyframeAtTime,
  generatePoseCreatorClipCapturedAlias,
  generatePoseCreatorClipEventId,
  generatePoseCreatorClipPoseAlias,
  normalizePoseCreatorClipPlaybackSpeed,
  normalizePoseCreatorClipSnapInterval,
  patchPoseCreatorClipDraft,
  patchPoseCreatorClipEventDraft,
  patchPoseCreatorClipKeyframeDraft,
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
import type { PoseCreatorModelSource } from "@/ui/pose-creator/poseCreatorPreview";

export type PoseCreatorSavedDraftSource = Pick<
  PoseCreatorModelSource,
  "key" | "sourceType" | "displayName" | "sourceLabel" | "versionLabel"
>;

export type PoseCreatorSavedDraft = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  source: PoseCreatorSavedDraftSource;
  basePose: PoseCreatorBasePose;
  pose: AnimaPose;
};

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
  selectedSavedDraftId: string | null;
  isDirty: boolean;
  importError?: string | null;
};

export type PoseCreatorClipInlineEditState = {
  alias: string;
  keyframeId: string | null;
  originalPose: AnimaPoseClipPose;
  previousBoneDrafts: PoseCreatorBoneDrafts;
  previousExpressionDrafts: PoseCreatorExpressionDrafts;
  previousDraftName: string;
  previousIsDirty: boolean;
  isDirty: boolean;
};

type PoseCreatorPoseUndoSnapshot = {
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
  isDirty: boolean;
};

type PoseCreatorClipUndoSnapshot = {
  poses: PoseCreatorClipDraft["poses"];
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

export type PoseCreatorSaveLocalDraftInput = {
  source: PoseCreatorModelSource;
  basePose: PoseCreatorBasePose;
  pose: AnimaPose;
};

// Give new pose sessions an immediately usable rotation handle. Explicit bone
// selections remain independent of helper visibility and model loading.
const DEFAULT_POSE_CREATOR_SELECTED_BONE = "leftUpperArm";

export const POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID = "__vrm_t_pose__";
export const DEFAULT_POSE_CREATOR_BASE_POSE: PoseCreatorBasePose =
  RELAXED_REST_POSE_ID;
export const POSE_CREATOR_LOCAL_DRAFTS_STORAGE_KEY =
  "anima.poseCreator.localDrafts.v1";
export const POSE_CREATOR_LOCAL_DRAFTS_SCHEMA = "poseCreatorLocalDrafts/1.0";
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeIsoDateString(value: unknown): string | null {
  const text = sanitizeRequiredString(value);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return text;
}

function sanitizeSavedDraftSource(
  value: unknown,
): PoseCreatorSavedDraftSource | null {
  if (!isRecord(value)) return null;
  const key = sanitizeRequiredString(value.key);
  const displayName = sanitizeRequiredString(value.displayName);
  const versionLabel = sanitizeRequiredString(value.versionLabel);
  const sourceLabel = sanitizeRequiredString(value.sourceLabel);
  const sourceType = sanitizeRequiredString(value.sourceType);
  if (
    key &&
    displayName &&
    versionLabel &&
    sourceLabel === "Preview Anima" &&
    sourceType === "resolved_entry"
  ) {
    return {
      key,
      displayName,
      versionLabel,
      sourceLabel,
      sourceType,
    };
  }

  return null;
}

function sanitizeSavedDraft(value: unknown): PoseCreatorSavedDraft | null {
  if (!isRecord(value)) return null;
  const id = sanitizeRequiredString(value.id);
  const name = sanitizeRequiredString(value.name);
  const createdAt = sanitizeIsoDateString(value.createdAt);
  const updatedAt = sanitizeIsoDateString(value.updatedAt);
  const source = sanitizeSavedDraftSource(value.source);
  const basePose = sanitizeRequiredString(value.basePose);
  if (!id || !name || !createdAt || !updatedAt || !source || !basePose) {
    return null;
  }

  try {
    return {
      id,
      name,
      createdAt,
      updatedAt,
      source,
      basePose,
      pose: cloneAnimaPose(parseAnimaPose(value.pose)),
    };
  } catch {
    return null;
  }
}

function getBrowserLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sortSavedDrafts(
  drafts: PoseCreatorSavedDraft[],
): PoseCreatorSavedDraft[] {
  return [...drafts].sort((left, right) => {
    const dateDelta = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    if (dateDelta !== 0) return dateDelta;
    return left.name.localeCompare(right.name);
  });
}

function readLocalDraftsFromStorage(): PoseCreatorSavedDraft[] {
  const storage = getBrowserLocalStorage();
  if (!storage) return [];

  try {
    const rawValue = storage.getItem(POSE_CREATOR_LOCAL_DRAFTS_STORAGE_KEY);
    if (!rawValue) return [];
    const value: unknown = JSON.parse(rawValue);
    if (
      !isRecord(value) ||
      value.schema !== POSE_CREATOR_LOCAL_DRAFTS_SCHEMA ||
      !Array.isArray(value.drafts)
    ) {
      return [];
    }

    const drafts: PoseCreatorSavedDraft[] = [];
    const seenIds = new Set<string>();
    for (const item of value.drafts) {
      const draft = sanitizeSavedDraft(item);
      if (!draft || seenIds.has(draft.id)) continue;
      seenIds.add(draft.id);
      drafts.push(draft);
    }
    return sortSavedDrafts(drafts);
  } catch {
    return [];
  }
}

function persistLocalDrafts(drafts: PoseCreatorSavedDraft[]): string | null {
  const storage = getBrowserLocalStorage();
  if (!storage) return "Browser local storage is unavailable.";

  try {
    storage.setItem(
      POSE_CREATOR_LOCAL_DRAFTS_STORAGE_KEY,
      JSON.stringify({
        schema: POSE_CREATOR_LOCAL_DRAFTS_SCHEMA,
        drafts: sortSavedDrafts(drafts),
      }),
    );
    return null;
  } catch {
    return "Failed to write local pose drafts.";
  }
}

function createSavedDraftSource(
  source: PoseCreatorModelSource,
): PoseCreatorSavedDraftSource {
  return {
    key: source.key,
    sourceType: source.sourceType,
    displayName: source.displayName,
    sourceLabel: source.sourceLabel,
    versionLabel: source.versionLabel,
  };
}

function slugifyDraftName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "pose";
}

function createUniqueDraftId(
  name: string,
  savedDrafts: PoseCreatorSavedDraft[],
): string {
  const baseId = slugifyDraftName(name);
  const usedIds = new Set(savedDrafts.map((draft) => draft.id));
  if (!usedIds.has(baseId)) return baseId;

  let suffix = 2;
  while (usedIds.has(`${baseId}-${suffix}`)) {
    suffix += 1;
  }
  return `${baseId}-${suffix}`;
}

const DEFAULT_NEW_POSE_NAME = "New Pose";

function createUniqueNewPoseName(savedDrafts: PoseCreatorSavedDraft[]): string {
  const usedNames = new Set(
    savedDrafts.map((draft) => draft.name.trim().toLocaleLowerCase()),
  );
  if (!usedNames.has(DEFAULT_NEW_POSE_NAME.toLocaleLowerCase())) {
    return DEFAULT_NEW_POSE_NAME;
  }

  let suffix = 1;
  while (
    usedNames.has(`${DEFAULT_NEW_POSE_NAME} (${suffix})`.toLocaleLowerCase())
  ) {
    suffix += 1;
  }
  return `${DEFAULT_NEW_POSE_NAME} (${suffix})`;
}

function withDraftMetadata(
  pose: AnimaPose,
  id: string,
  name: string,
): AnimaPose {
  return parseAnimaPose({
    ...cloneAnimaPose(pose),
    id,
    name,
  });
}

function hasCurrentSavedDraft(state: PoseCreatorStoreState): boolean {
  return state.selectedSavedDraftId !== null;
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
 * Exact server document identity belongs to PoseCreatorDocumentProvider,
 * server queries belong to TanStack Query, and interrupted Save recovery is
 * owned by the typed action editor actions rather than this Zustand store.
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
  savedDrafts: PoseCreatorSavedDraft[];
  selectedSavedDraftId: string | null;
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
    clip: AnimaPoseClip,
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
  selectClipPoseAlias: (alias: string | null) => void;
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
  convertSelectedClipPoseRefToInline: () => string | null;
  duplicateSelectedClipPoseAliasForEdit: () => string | null;
  beginClipInlinePoseEdit: (input: {
    alias: string;
    keyframeId: string | null;
    originalPose: AnimaPoseClipPose;
    boneDrafts: PoseCreatorBoneDrafts;
    expressionDrafts: PoseCreatorExpressionDrafts;
    draftName: string;
  }) => void;
  commitClipInlinePoseEdit: (pose: AnimaPose) => void;
  cancelClipInlinePoseEdit: () => void;
  captureClipPoseAtPlayhead: (pose: AnimaPose) => void;
  addPoseToClip: (
    pose: AnimaPose,
    preferredAlias: string,
    options?: { atPlayhead?: boolean; timeSec?: number },
  ) => string;
  /** Create or update the sparse expression landmark at the playhead. */
  setClipExpressionsAtPlayhead: (expressions: Record<string, number>) => void;
  addClipKeyframeForAliasAtPlayhead: (alias: string) => void;
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
  duplicateSelectedClipKeyframe: () => void;
  duplicateSelectedClipEvent: () => void;
  nudgeSelectedClipKeyframe: (direction: -1 | 1) => void;
  nudgeSelectedClipEvent: (direction: -1 | 1) => void;
  clearClipEvents: (kind?: AnimaPoseClipEvent["kind"]) => void;
  setClipDurationToFinalKeyframe: () => void;
  retimeClipDuration: (
    duration: number,
    options: { scaleKeyframes: boolean },
  ) => void;
  copyFirstClipKeyframeToEnd: () => void;
  setFinalClipKeyframeToFirstPose: () => void;
  addReturnToBaseClipKeyframe: () => void;
  setModelSource: (source: PoseCreatorModelSource | null) => void;
  setBasePose: (basePose: PoseCreatorBasePose) => void;
  setActiveAvatar: (avatar: Avatar | null) => void;
  setLoadStatus: (status: PoseCreatorLoadStatus, error?: string | null) => void;
  setLoadProgress: (progress: AvatarLoadProgress | null) => void;
  setSelectedBone: (boneName: string | null) => void;
  focusBone: (boneName: string) => void;
  setBoneHelperNodesVisible: (visible: boolean) => void;
  setMirrorOppositeBone: (enabled: boolean) => void;
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
  hydrateLocalDrafts: () => void;
  saveLocalDraft: (
    input: PoseCreatorSaveLocalDraftInput,
  ) => PoseCreatorSavedDraft | null;
  deleteLocalDraft: (id: string) => void;
  loadSavedDraft: (
    id: string,
    replacement: Omit<
      PoseCreatorDraftReplacement,
      "draftName" | "selectedSavedDraftId" | "isDirty" | "importError"
    >,
  ) => PoseCreatorSavedDraft | null;
  replaceDraftFromImport: (
    replacement: Omit<
      PoseCreatorDraftReplacement,
      "selectedSavedDraftId" | "isDirty"
    >,
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
  | "selectedSavedDraftId"
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
    selectedSavedDraftId: null,
    importError: null,
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
    selectedSavedDraftId: null,
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

function clonePoseCreatorClipPoses(
  poses: PoseCreatorClipDraft["poses"],
): PoseCreatorClipDraft["poses"] {
  return Object.fromEntries(
    Object.entries(poses).map(([alias, pose]) => [
      alias,
      clonePoseCreatorClipPose(pose),
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
  state: PoseCreatorStoreState,
): PoseCreatorClipUndoSnapshot {
  return {
    poses: clonePoseCreatorClipPoses(state.clipDraft.poses),
    keyframes: state.clipDraft.keyframes.map((keyframe) => ({
      ...keyframe,
      ...(keyframe.transition
        ? { transition: clonePoseCreatorClipTransition(keyframe.transition) }
        : {}),
    })),
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
      ?.quaternion.fromArray(draft.baseQuaternion);
  }
  for (const [boneName, draft] of Object.entries(snapshot.boneDrafts)) {
    vrm.humanoid
      .getNormalizedBoneNode(boneName as VRMHumanBoneName)
      ?.quaternion.setFromEuler(
        new Euler(
          MathUtils.degToRad(draft.rotationDegrees.x),
          MathUtils.degToRad(draft.rotationDegrees.y),
          MathUtils.degToRad(draft.rotationDegrees.z),
          "XYZ",
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
    JSON.stringify(left.poses) === JSON.stringify(right.poses) &&
    JSON.stringify(left.keyframes) === JSON.stringify(right.keyframes) &&
    JSON.stringify(left.events) === JSON.stringify(right.events)
  );
}

function areInlinePoseUndoSnapshotsEqual(
  left: PoseCreatorInlinePoseUndoSnapshot,
  right: PoseCreatorInlinePoseUndoSnapshot,
): boolean {
  return (
    JSON.stringify(left.boneDrafts) === JSON.stringify(right.boneDrafts) &&
    JSON.stringify(left.expressionDrafts) ===
      JSON.stringify(right.expressionDrafts)
  );
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
): Partial<PoseCreatorStoreState> {
  // The outer interaction already owns the before-snapshot and compares it
  // once on commit. Avoid cloning/serializing every intermediate pointer move.
  const kind = state.clipInlineEdit ? "inline_pose" : "pose";
  if (state.undoGroup?.kind === kind) return {};

  const current = state.clipInlineEdit
    ? createInlinePoseUndoSnapshot(state)
    : createPoseUndoSnapshot(state);
  const next = { boneDrafts, expressionDrafts, isDirty: true };
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
    snapshot.keyframes.map((keyframe) =>
      patchPoseCreatorClipKeyframeDraft(
        keyframe,
        { time: keyframe.time },
        draft.duration,
      ),
    ),
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
  const poses = clonePoseCreatorClipPoses(snapshot.poses);
  const selectedPoseAlias =
    snapshot.selectedPoseAlias && poses[snapshot.selectedPoseAlias]
      ? snapshot.selectedPoseAlias
      : selectedKeyframeId
        ? (keyframes.find((keyframe) => keyframe.id === selectedKeyframeId)
            ?.pose ?? null)
        : null;

  return withPoseCreatorClipValidation(
    {
      ...draft,
      poses,
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

function insertClipPoseAtTime(
  draft: PoseCreatorClipDraft,
  pose: AnimaPoseClipPose,
  alias: string,
  time: number,
): PoseCreatorClipDraft {
  const clampedTime = clampPoseCreatorClipTime(time, draft.duration);
  const existingKeyframe = findPoseCreatorClipKeyframeAtTime(
    draft.keyframes,
    clampedTime,
  );
  const poses = {
    ...draft.poses,
    [alias]: clonePoseCreatorClipPose(pose),
  };
  const selectedKeyframeId =
    existingKeyframe?.id ??
    createPoseCreatorClipKeyframeDraft(draft, alias, clampedTime).id;
  const keyframes = existingKeyframe
    ? draft.keyframes.map((keyframe) =>
        keyframe.id === existingKeyframe.id
          ? {
              ...keyframe,
              time: clampedTime,
              pose: alias,
            }
          : keyframe,
      )
    : [
        ...draft.keyframes,
        {
          id: selectedKeyframeId,
          time: clampedTime,
          pose: alias,
        },
      ];

  return withDirtyClipValidation({
    ...draft,
    poses,
    keyframes: sortPoseCreatorClipKeyframes(keyframes),
    currentTimeSec: clampedTime,
    selectedKeyframeId,
    selectedPoseAlias: alias,
  });
}

function setClipExpressionsAtTime(
  draft: PoseCreatorClipDraft,
  expressions: Record<string, number>,
): PoseCreatorClipDraft {
  const clampedTime = clampPoseCreatorClipTime(
    draft.currentTimeSec,
    draft.duration,
  );
  const existingKeyframe = findPoseCreatorClipKeyframeAtTime(
    draft.keyframes,
    clampedTime,
  );
  const existingAlias = existingKeyframe?.pose ?? null;
  const existingPose = existingAlias ? draft.poses[existingAlias] : null;
  const existingAliasUseCount = existingAlias
    ? draft.keyframes.filter((keyframe) => keyframe.pose === existingAlias)
        .length
    : 0;
  const alias =
    existingAlias &&
    existingPose &&
    !isAnimaPoseClipRef(existingPose) &&
    existingAliasUseCount === 1
      ? existingAlias
      : generatePoseCreatorClipPoseAlias(
          "expression",
          Object.keys(draft.poses),
        );
  const sparseExpressions: Record<string, number> = {};
  for (const [expressionName, value] of Object.entries(expressions)) {
    if (!Number.isFinite(value)) continue;
    const normalized =
      Math.round(MathUtils.clamp(value, 0, 1) * 10_000) / 10_000;
    if (Math.abs(normalized) > 1e-6) {
      sparseExpressions[expressionName] = normalized;
    }
  }
  const pose: AnimaPoseClipPose =
    Object.keys(sparseExpressions).length > 0
      ? { expressions: sparseExpressions }
      : {};
  const inserted = insertClipPoseAtTime(draft, pose, alias, clampedTime);
  const usedAliases = new Set(
    inserted.keyframes.map((keyframe) => keyframe.pose),
  );
  return withDirtyClipValidation({
    ...inserted,
    poses: Object.fromEntries(
      Object.entries(inserted.poses).filter(([poseAlias]) =>
        usedAliases.has(poseAlias),
      ),
    ),
  });
}

function addClipKeyframeForAlias(
  draft: PoseCreatorClipDraft,
  alias: string,
): PoseCreatorClipDraft {
  if (!draft.poses[alias]) return draft;
  const clampedTime = clampPoseCreatorClipTime(
    draft.currentTimeSec,
    draft.duration,
  );
  const existingKeyframe = findPoseCreatorClipKeyframeAtTime(
    draft.keyframes,
    clampedTime,
  );
  const selectedKeyframeId =
    existingKeyframe?.id ??
    createPoseCreatorClipKeyframeDraft(draft, alias, clampedTime).id;
  const keyframes = existingKeyframe
    ? draft.keyframes.map((keyframe) =>
        keyframe.id === existingKeyframe.id
          ? { ...keyframe, pose: alias }
          : keyframe,
      )
    : [
        ...draft.keyframes,
        {
          id: selectedKeyframeId,
          time: clampedTime,
          pose: alias,
        },
      ];

  return withDirtyClipValidation({
    ...draft,
    keyframes: sortPoseCreatorClipKeyframes(keyframes),
    currentTimeSec: clampedTime,
    selectedKeyframeId,
    selectedPoseAlias: alias,
  });
}

function findAvailableClipKeyframeTime(
  draft: PoseCreatorClipDraft,
  selectedTime: number,
): number {
  const step = 0.05;
  const duration = Math.max(0, draft.duration);
  const usedTimes = new Set(
    draft.keyframes.map((keyframe) => keyframe.time.toFixed(3)),
  );

  for (let index = 1; index <= 200; index += 1) {
    const later = clampPoseCreatorClipTime(
      selectedTime + step * index,
      duration,
    );
    if (!usedTimes.has(later.toFixed(3))) return later;

    const earlier = clampPoseCreatorClipTime(
      selectedTime - step * index,
      duration,
    );
    if (!usedTimes.has(earlier.toFixed(3))) return earlier;
  }

  return clampPoseCreatorClipTime(selectedTime, duration);
}

function getReusableBaseAlias(draft: PoseCreatorClipDraft): string | null {
  if (draft.basePose === POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID) return null;

  for (const [alias, pose] of Object.entries(draft.poses)) {
    if (isAnimaPoseClipRef(pose) && pose.ref === draft.basePose) {
      return alias;
    }
  }

  return null;
}

function getFirstClipKeyframe(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipKeyframeDraft | null {
  return sortPoseCreatorClipKeyframes(draft.keyframes)[0] ?? null;
}

function getFinalClipKeyframe(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipKeyframeDraft | null {
  const keyframes = sortPoseCreatorClipKeyframes(draft.keyframes);
  return keyframes[keyframes.length - 1] ?? null;
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

function retimePoseCreatorClipDraft(
  draft: PoseCreatorClipDraft,
  duration: number,
  scaleKeyframes: boolean,
): PoseCreatorClipDraft {
  const nextDuration = clampPoseCreatorClipDuration(duration);
  const previousDuration = Math.max(0, draft.duration);
  const scale =
    scaleKeyframes && previousDuration > 0
      ? nextDuration / previousDuration
      : 1;
  const keyframes = draft.keyframes.map((keyframe) =>
    patchPoseCreatorClipKeyframeDraft(
      keyframe,
      {
        time: scaleKeyframes ? keyframe.time * scale : keyframe.time,
      },
      nextDuration,
    ),
  );
  const events = draft.events.map((event) =>
    patchPoseCreatorClipEventDraft(
      event,
      {
        time: scaleKeyframes ? event.time * scale : event.time,
        ...(scaleKeyframes &&
        isAnimaPoseClipVFXEvent(event) &&
        event.duration !== undefined
          ? { duration: event.duration * scale }
          : {}),
      },
      nextDuration,
    ),
  );
  const nextSelectedKeyframe =
    keyframes.find((keyframe) => keyframe.id === draft.selectedKeyframeId) ??
    null;

  return withDirtyClipValidation({
    ...draft,
    duration: nextDuration,
    keyframes: sortPoseCreatorClipKeyframes(keyframes),
    events: sortPoseCreatorClipEvents(events),
    currentTimeSec: clampPoseCreatorClipTime(
      scaleKeyframes ? draft.currentTimeSec * scale : draft.currentTimeSec,
      nextDuration,
    ),
    selectedPoseAlias: nextSelectedKeyframe?.pose ?? draft.selectedPoseAlias,
  });
}

function copyFirstClipKeyframeToEnd(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipDraft {
  const firstKeyframe = getFirstClipKeyframe(draft);
  if (!firstKeyframe) return draft;

  const endTime = clampPoseCreatorClipTime(draft.duration, draft.duration);
  const existingKeyframe = findPoseCreatorClipKeyframeAtTime(
    draft.keyframes,
    endTime,
  );
  const selectedKeyframeId =
    existingKeyframe?.id ??
    createPoseCreatorClipKeyframeDraft(draft, firstKeyframe.pose, endTime).id;
  const keyframes = existingKeyframe
    ? draft.keyframes.map((keyframe) =>
        keyframe.id === existingKeyframe.id
          ? patchPoseCreatorClipKeyframeDraft(
              keyframe,
              {
                time: endTime,
                pose: firstKeyframe.pose,
              },
              draft.duration,
            )
          : keyframe,
      )
    : [
        ...draft.keyframes,
        {
          id: selectedKeyframeId,
          time: endTime,
          pose: firstKeyframe.pose,
        },
      ];

  return withDirtyClipValidation({
    ...draft,
    keyframes: sortPoseCreatorClipKeyframes(keyframes),
    selectedKeyframeId,
    selectedPoseAlias: firstKeyframe.pose,
    currentTimeSec: endTime,
  });
}

function setFinalClipKeyframeToFirstPose(
  draft: PoseCreatorClipDraft,
): PoseCreatorClipDraft {
  const firstKeyframe = getFirstClipKeyframe(draft);
  const finalKeyframe = getFinalClipKeyframe(draft);
  if (!firstKeyframe || !finalKeyframe) return draft;

  return withDirtyClipValidation({
    ...draft,
    keyframes: sortPoseCreatorClipKeyframes(
      draft.keyframes.map((keyframe) =>
        keyframe.id === finalKeyframe.id
          ? patchPoseCreatorClipKeyframeDraft(
              keyframe,
              { pose: firstKeyframe.pose },
              draft.duration,
            )
          : keyframe,
      ),
    ),
    selectedKeyframeId: finalKeyframe.id,
    selectedPoseAlias: firstKeyframe.pose,
    currentTimeSec: finalKeyframe.time,
  });
}

function convertSelectedClipPoseRefToInline(
  draft: PoseCreatorClipDraft,
): { draft: PoseCreatorClipDraft; alias: string } | null {
  const selectedKeyframe = getSelectedClipKeyframe(draft);
  if (!selectedKeyframe) return null;

  const pose = draft.poses[selectedKeyframe.pose];
  if (!isAnimaPoseClipRef(pose)) {
    return { draft, alias: selectedKeyframe.pose };
  }

  const resolvedPose = getResolvedAvatarPose(pose.ref);
  return {
    alias: selectedKeyframe.pose,
    draft: withDirtyClipValidation({
      ...draft,
      poses: {
        ...draft.poses,
        [selectedKeyframe.pose]: createPoseCreatorClipInlinePose(resolvedPose),
      },
      selectedPoseAlias: selectedKeyframe.pose,
    }),
  };
}

function duplicateSelectedClipPoseAliasForEdit(
  draft: PoseCreatorClipDraft,
): { draft: PoseCreatorClipDraft; alias: string } | null {
  const selectedKeyframe = getSelectedClipKeyframe(draft);
  if (!selectedKeyframe) return null;

  const sourcePose = draft.poses[selectedKeyframe.pose];
  if (!sourcePose) return null;
  const alias = generatePoseCreatorClipPoseAlias(
    `${selectedKeyframe.pose}Copy`,
    Object.keys(draft.poses),
  );
  const pose = isAnimaPoseClipRef(sourcePose)
    ? createPoseCreatorClipInlinePose(getResolvedAvatarPose(sourcePose.ref))
    : clonePoseCreatorClipPose(sourcePose);

  return {
    alias,
    draft: withDirtyClipValidation({
      ...draft,
      poses: {
        ...draft.poses,
        [alias]: pose,
      },
      keyframes: sortPoseCreatorClipKeyframes(
        draft.keyframes.map((keyframe) =>
          keyframe.id === selectedKeyframe.id
            ? patchPoseCreatorClipKeyframeDraft(
                keyframe,
                { pose: alias },
                draft.duration,
              )
            : keyframe,
        ),
      ),
      selectedKeyframeId: selectedKeyframe.id,
      selectedPoseAlias: alias,
    }),
  };
}

export const usePoseCreatorStore = create<PoseCreatorStoreState>(
  (set, get) => ({
    ...resetTransientStateForSource(null),
    authoringMode: "pose",
    basePose: DEFAULT_POSE_CREATOR_BASE_POSE,
    boneHelperNodesVisible: true,
    savedDrafts: [],
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
            ? {}
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
              ? {}
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
          clipInlineEdit: {
            ...state.clipInlineEdit,
            isDirty: snapshot.isDirty,
          },
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
          clipInlineEdit: {
            ...state.clipInlineEdit,
            isDirty: snapshot.isDirty,
          },
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
        const clipDraft = patchPoseCreatorClipDraft(
          state.clipDraft,
          patch,
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        );
        return {
          clipDraft,
          clipPlaybackPlaying: false,
          // Excluded settings are not undone, so older snapshots remain dirty.
          clipUndoHistory: state.clipUndoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: clipDraft.isDirty || snapshot.isDirty,
          })),
          clipRedoHistory: state.clipRedoHistory.map((snapshot) => ({
            ...snapshot,
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
    selectClipPoseAlias: (selectedPoseAlias) =>
      set((state) => ({
        clipDraft: {
          ...state.clipDraft,
          selectedPoseAlias:
            selectedPoseAlias && state.clipDraft.poses[selectedPoseAlias]
              ? selectedPoseAlias
              : null,
        },
      })),
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
    convertSelectedClipPoseRefToInline: () => {
      let alias: string | null = null;
      set((state) => {
        try {
          const result = convertSelectedClipPoseRefToInline(state.clipDraft);
          if (!result) return state;
          alias = result.alias;
          return {
            ...recordClipDraftUndo(state, result.draft),
            clipDraft: result.draft,
            clipInlineEdit:
              state.clipInlineEdit?.alias === result.alias
                ? null
                : state.clipInlineEdit,
            clipPlaybackPlaying: false,
          };
        } catch {
          return state;
        }
      });
      return alias;
    },
    duplicateSelectedClipPoseAliasForEdit: () => {
      let alias: string | null = null;
      set((state) => {
        try {
          const result = duplicateSelectedClipPoseAliasForEdit(state.clipDraft);
          if (!result) return state;
          alias = result.alias;
          return {
            ...recordClipDraftUndo(state, result.draft),
            clipDraft: result.draft,
            clipInlineEdit: null,
            clipPlaybackPlaying: false,
          };
        } catch {
          return state;
        }
      });
      return alias;
    },
    beginClipInlinePoseEdit: (input) =>
      set((state) => ({
        clipInlineEdit: {
          alias: input.alias,
          keyframeId: input.keyframeId,
          originalPose: clonePoseCreatorClipPose(input.originalPose),
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
        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          poses: {
            ...state.clipDraft.poses,
            [edit.alias]: createPoseCreatorClipInlinePose(parseAnimaPose(pose)),
          },
          selectedPoseAlias: edit.alias,
        });
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
          clipDraft: withPoseCreatorClipValidation(
            {
              ...state.clipDraft,
              poses: {
                ...state.clipDraft.poses,
                [edit.alias]: clonePoseCreatorClipPose(edit.originalPose),
              },
              selectedPoseAlias: edit.alias,
            },
            POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
          ),
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
    captureClipPoseAtPlayhead: (pose) =>
      set((state) => {
        const alias = generatePoseCreatorClipCapturedAlias(
          Object.keys(state.clipDraft.poses),
        );
        const clipDraft = insertClipPoseAtTime(
          state.clipDraft,
          createPoseCreatorClipInlinePose(pose),
          alias,
          state.clipDraft.currentTimeSec,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    addPoseToClip: (pose, preferredAlias, options = {}) => {
      const alias = generatePoseCreatorClipPoseAlias(
        preferredAlias,
        Object.keys(get().clipDraft.poses),
      );
      set((state) => {
        // Explicit drop times take precedence; callers already apply snapping.
        const clipDraft =
          options.timeSec !== undefined || options.atPlayhead
            ? insertClipPoseAtTime(
                state.clipDraft,
                createPoseCreatorClipInlinePose(pose),
                alias,
                options.timeSec ?? state.clipDraft.currentTimeSec,
              )
            : withDirtyClipValidation({
                ...state.clipDraft,
                poses: {
                  ...state.clipDraft.poses,
                  [alias]: createPoseCreatorClipInlinePose(pose),
                },
                selectedPoseAlias: alias,
              });
        if (options.timeSec !== undefined) clipDraft.selectedEventId = null;
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          ...(options.timeSec !== undefined
            ? { clipPlaybackAbsoluteTimeSec: clipDraft.currentTimeSec }
            : {}),
        };
      });
      return alias;
    },
    setClipExpressionsAtPlayhead: (expressions) =>
      set((state) => {
        if (state.clipInlineEdit) return state;
        const clipDraft = setClipExpressionsAtTime(
          state.clipDraft,
          expressions,
        );
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    addClipKeyframeForAliasAtPlayhead: (alias) =>
      set((state) => {
        const clipDraft = addClipKeyframeForAlias(state.clipDraft, alias);
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

        const keyframes = state.clipDraft.keyframes.map((keyframe) =>
          keyframe.id === selectedKeyframe.id
            ? patchPoseCreatorClipKeyframeDraft(
                keyframe,
                patch,
                state.clipDraft.duration,
              )
            : keyframe,
        );
        const nextSelectedKeyframe =
          keyframes.find((keyframe) => keyframe.id === selectedKeyframe.id) ??
          selectedKeyframe;

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          keyframes: sortPoseCreatorClipKeyframes(keyframes),
          currentTimeSec: nextSelectedKeyframe.time,
          selectedPoseAlias: nextSelectedKeyframe.pose,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextSelectedKeyframe.time,
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
        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          keyframes: sortPoseCreatorClipKeyframes(
            state.clipDraft.keyframes.map((candidate) =>
              candidate.id === keyframe.id
                ? patchPoseCreatorClipKeyframeDraft(
                    candidate,
                    { time: nextTime },
                    state.clipDraft.duration,
                  )
                : candidate,
            ),
          ),
          selectedKeyframeId: keyframe.id,
          selectedPoseAlias: keyframe.pose,
          currentTimeSec: nextTime,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
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

        const selectedIndex = state.clipDraft.keyframes.findIndex(
          (keyframe) => keyframe.id === selectedKeyframe.id,
        );
        const keyframes = state.clipDraft.keyframes.filter(
          (keyframe) => keyframe.id !== selectedKeyframe.id,
        );
        const nextSelectedKeyframe =
          keyframes[Math.min(selectedIndex, keyframes.length - 1)] ??
          keyframes[selectedIndex - 1] ??
          null;

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          keyframes,
          selectedKeyframeId: nextSelectedKeyframe?.id ?? null,
          selectedPoseAlias:
            nextSelectedKeyframe?.pose ?? state.clipDraft.selectedPoseAlias,
          currentTimeSec:
            nextSelectedKeyframe?.time ?? state.clipDraft.currentTimeSec,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipPlaybackAbsoluteTimeSec:
            nextSelectedKeyframe?.time ?? state.clipDraft.currentTimeSec,
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
    duplicateSelectedClipKeyframe: () =>
      set((state) => {
        const selectedKeyframe = getSelectedClipKeyframe(state.clipDraft);
        if (!selectedKeyframe) return state;

        const nextTime = findAvailableClipKeyframeTime(
          state.clipDraft,
          selectedKeyframe.time,
        );
        const keyframe: PoseCreatorClipKeyframeDraft = {
          id: createPoseCreatorClipKeyframeDraft(
            state.clipDraft,
            selectedKeyframe.pose,
            nextTime,
          ).id,
          time: nextTime,
          pose: selectedKeyframe.pose,
          ...(selectedKeyframe.transition
            ? {
                transition: clonePoseCreatorClipTransition(
                  selectedKeyframe.transition,
                ),
              }
            : {}),
        };

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          keyframes: sortPoseCreatorClipKeyframes([
            ...state.clipDraft.keyframes,
            keyframe,
          ]),
          selectedKeyframeId: keyframe.id,
          selectedPoseAlias: keyframe.pose,
          currentTimeSec: keyframe.time,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: keyframe.time,
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
    nudgeSelectedClipKeyframe: (direction) =>
      set((state) => {
        const selectedKeyframe = getSelectedClipKeyframe(state.clipDraft);
        if (!selectedKeyframe) return { clipPlaybackPlaying: false };
        const nextTime = clampPoseCreatorClipTime(
          selectedKeyframe.time + state.clipSnapIntervalSec * direction,
          state.clipDraft.duration,
        );

        const clipDraft = withDirtyClipValidation({
          ...state.clipDraft,
          keyframes: sortPoseCreatorClipKeyframes(
            state.clipDraft.keyframes.map((keyframe) =>
              keyframe.id === selectedKeyframe.id
                ? patchPoseCreatorClipKeyframeDraft(
                    keyframe,
                    { time: nextTime },
                    state.clipDraft.duration,
                  )
                : keyframe,
            ),
          ),
          selectedKeyframeId: selectedKeyframe.id,
          selectedPoseAlias: selectedKeyframe.pose,
          currentTimeSec: nextTime,
        });
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
          clipPlaybackAbsoluteTimeSec: nextTime,
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
    setClipDurationToFinalKeyframe: () =>
      set((state) => {
        const finalKeyframe = getFinalClipKeyframe(state.clipDraft);
        if (!finalKeyframe) return { clipPlaybackPlaying: false };
        const clipDraft = retimePoseCreatorClipDraft(
          state.clipDraft,
          finalKeyframe.time,
          false,
        );
        return {
          clipDraft,
          clipUndoHistory: state.clipUndoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: true,
          })),
          clipRedoHistory: state.clipRedoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: true,
          })),
          clipPlaybackPlaying: false,
        };
      }),
    retimeClipDuration: (duration, options) =>
      set((state) => {
        const clipDraft = retimePoseCreatorClipDraft(
          state.clipDraft,
          duration,
          options.scaleKeyframes,
        );
        return {
          clipDraft,
          clipUndoHistory: state.clipUndoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: true,
          })),
          clipRedoHistory: state.clipRedoHistory.map((snapshot) => ({
            ...snapshot,
            isDirty: true,
          })),
          clipPlaybackPlaying: false,
        };
      }),
    copyFirstClipKeyframeToEnd: () =>
      set((state) => {
        const clipDraft = copyFirstClipKeyframeToEnd(state.clipDraft);
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    setFinalClipKeyframeToFirstPose: () =>
      set((state) => {
        const clipDraft = setFinalClipKeyframeToFirstPose(state.clipDraft);
        return {
          ...recordClipDraftUndo(state, clipDraft),
          clipDraft,
          clipPlaybackPlaying: false,
        };
      }),
    addReturnToBaseClipKeyframe: () =>
      set((state) => {
        const reusableAlias = getReusableBaseAlias(state.clipDraft);
        const alias =
          reusableAlias ??
          (state.clipDraft.basePose === POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID
            ? null
            : generatePoseCreatorClipPoseAlias("base", [
                ...Object.keys(state.clipDraft.poses),
                state.clipDraft.basePose,
              ]));
        if (!alias) return state;

        const draft = reusableAlias
          ? state.clipDraft
          : {
              ...state.clipDraft,
              poses: {
                ...state.clipDraft.poses,
                [alias]: createPoseCreatorClipRefPose(state.clipDraft.basePose),
              },
            };
        const pose = draft.poses[alias];
        if (!pose) return state;

        const clipDraft = insertClipPoseAtTime(
          draft,
          pose,
          alias,
          draft.duration,
        );
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
        ...recordPoseDraftUndo(state, {}, state.expressionDrafts),
        boneDrafts: {},
        clipInlineEdit: markClipInlineEditDirty(state.clipInlineEdit),
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
        const selectedDraft = state.selectedSavedDraftId
          ? state.savedDrafts.find(
              (draft) => draft.id === state.selectedSavedDraftId,
            )
          : null;
        const trimmedName = draftName.trim();
        const isDirty =
          state.isDirty ||
          Boolean(selectedDraft && trimmedName !== selectedDraft.name);
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
    hydrateLocalDrafts: () =>
      set((state) => {
        const savedDrafts = readLocalDraftsFromStorage();
        return {
          savedDrafts,
          draftName: state.draftName,
          selectedSavedDraftId:
            state.selectedSavedDraftId &&
            savedDrafts.some((draft) => draft.id === state.selectedSavedDraftId)
              ? state.selectedSavedDraftId
              : null,
        };
      }),
    saveLocalDraft: (input) => {
      let savedDraft: PoseCreatorSavedDraft | null = null;

      set((state) => {
        const name =
          state.draftName.trim() || createUniqueNewPoseName(state.savedDrafts);

        const existingDraft = state.selectedSavedDraftId
          ? state.savedDrafts.find(
              (draft) => draft.id === state.selectedSavedDraftId,
            )
          : null;
        const id =
          existingDraft?.id ?? createUniqueDraftId(name, state.savedDrafts);
        const now = new Date().toISOString();
        savedDraft = {
          id,
          name,
          createdAt: existingDraft?.createdAt ?? now,
          updatedAt: now,
          source: createSavedDraftSource(input.source),
          basePose: input.basePose,
          pose: withDraftMetadata(input.pose, id, name),
        };

        const nextDrafts = sortSavedDrafts(
          existingDraft
            ? state.savedDrafts.map((draft) =>
                draft.id === existingDraft.id ? savedDraft! : draft,
              )
            : [savedDraft, ...state.savedDrafts],
        );
        const persistError = persistLocalDrafts(nextDrafts);
        const savedSnapshot = createPoseUndoSnapshot({
          ...state,
          isDirty: false,
        });
        return {
          savedDrafts: nextDrafts,
          selectedSavedDraftId: id,
          draftName: name,
          isDirty: persistError !== null,
          importError: persistError,
          poseUndoHistory: persistError
            ? state.poseUndoHistory
            : rebasePoseHistory(state.poseUndoHistory, savedSnapshot),
          poseRedoHistory: persistError
            ? state.poseRedoHistory
            : rebasePoseHistory(state.poseRedoHistory, savedSnapshot),
        };
      });

      return savedDraft;
    },
    deleteLocalDraft: (id) =>
      set((state) => {
        const nextDrafts = state.savedDrafts.filter((draft) => draft.id !== id);
        if (nextDrafts.length === state.savedDrafts.length) return state;

        const deletesCurrentDraft = state.selectedSavedDraftId === id;
        const persistError = persistLocalDrafts(nextDrafts);
        return {
          savedDrafts: nextDrafts,
          selectedSavedDraftId: deletesCurrentDraft
            ? null
            : state.selectedSavedDraftId,
          isDirty: deletesCurrentDraft
            ? hasDrafts(state.boneDrafts, state.expressionDrafts)
            : state.isDirty,
          importError: persistError,
        };
      }),
    loadSavedDraft: (id, replacement) => {
      const draft = get().savedDrafts.find((item) => item.id === id) ?? null;
      if (!draft) {
        set({ importError: "Saved draft was not found." });
        return null;
      }

      set({
        ...replacement,
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        draftName: draft.name,
        selectedSavedDraftId: draft.id,
        isDirty: false,
        poseUndoHistory: [],
        poseRedoHistory: [],
        undoGroup: null,
        exportPreview: null,
        importError: null,
      });
      return draft;
    },
    replaceDraftFromImport: (replacement) =>
      set({
        ...replacement,
        selectedBone: DEFAULT_POSE_CREATOR_SELECTED_BONE,
        selectedBoneFocusRequest: null,
        selectedSavedDraftId: null,
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
