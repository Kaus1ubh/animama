"use client";

import {
  useMemo,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { AnimaPoseClipAvatarVFXOverride } from "@/lib/avatar/poses/animaPoseClip";
import {
  defaultAvatarEffectAttachment,
  type AvatarEffectEditorAttachmentPatch,
} from "@/lib/avatar/vfx/editor";
import {
  POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
  usePoseCreatorStore,
} from "@/stores/pose-creator-store";
import {
  AvatarEffectHandleRenderer,
  createAvatarEffectManipulationState,
  useAvatarEffectManipulation,
} from "@/ui/avatar-effect-creator/AvatarEffectManipulator";
import {
  avatarEffectUseDocument,
  avatarEffectUseTransform,
  editAvatarEffectUse,
  sameAvatarEffectOverride,
} from "./avatarEffectUse";
import { buildAnimaPoseClipFromPoseCreatorDraft } from "./poseCreatorClipAuthoring";
import { poseCreatorScrubAppliedId } from "./poseCreatorClipEventPlayback";
import { useAvatarEffectUseSource } from "./PoseCreatorAvatarEffectUse";
import { usePoseCreatorClipUndoGrouping } from "./usePoseCreatorUndoGrouping";

/** Stands in while no event is manipulable; the hook is then disabled. */
const NO_ATTACHMENT = defaultAvatarEffectAttachment("sticker");

/**
 * Direct manipulation of the selected Avatar Effect event on the Action
 * creator's preview, with the Avatar Effect creator's handles. While playback
 * is paused and the playhead shows the event, its art can be dragged, scaled
 * and turned (or nudged with the arrow keys). A gesture moves the applied art
 * in place, as the effect creator does, and writes the event's override once
 * when it ends: one Undo step, and the preview re-applies the event once.
 * Mount `renderer` inside the preview Canvas and `overlay` above it;
 * `containerRef` is the preview's element.
 */
export function usePoseCreatorEffectHandles(
  containerRef: RefObject<HTMLElement | null>,
): {
  enabled: boolean;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  overlay: ReactNode;
  renderer: ReactNode;
} {
  const stateRef = useRef(createAvatarEffectManipulationState());
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The override the current gesture would write, when it changed one.
  const gestureRef = useRef<{
    override: AnimaPoseClipAvatarVFXOverride | undefined;
  } | null>(null);
  const activeAvatar = usePoseCreatorStore((state) => state.activeAvatar);
  const authoringMode = usePoseCreatorStore((state) => state.authoringMode);
  const clipDraft = usePoseCreatorStore((state) => state.clipDraft);
  const clipInlineEdit = usePoseCreatorStore((state) => state.clipInlineEdit);
  const playing = usePoseCreatorStore((state) => state.clipPlaybackPlaying);
  const updateSelectedClipEvent = usePoseCreatorStore(
    (state) => state.updateSelectedClipEvent,
  );
  const selected = useMemo(() => {
    const event = clipDraft.events.find(
      (candidate) => candidate.id === clipDraft.selectedEventId,
    );
    return event?.kind === "avatar_vfx" ? event : null;
  }, [clipDraft.events, clipDraft.selectedEventId]);
  const source = useAvatarEffectUseSource(selected);
  const attachment = useMemo(() => {
    if (!source || !selected) return null;
    try {
      return avatarEffectUseDocument(source.definition, selected.override)
        .attachment;
    } catch {
      // The inspector explains an override the effect cannot play.
      return null;
    }
  }, [selected, source]);
  const manipulable = Boolean(
    attachment &&
    attachment.kind !== "silhouette" &&
    activeAvatar &&
    authoringMode === "clip" &&
    !clipInlineEdit &&
    !playing,
  );
  // The id the paused preview applies the event's art under, while the
  // playhead shows it (see PoseCreatorClipPreviewSync).
  const appliedId = useMemo(() => {
    if (!manipulable || !selected) return null;
    const clip = buildAnimaPoseClipFromPoseCreatorDraft(clipDraft, {
      omittedBasePoseId: POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID,
    });
    return clip
      ? poseCreatorScrubAppliedId(clip, clipDraft.currentTimeSec, selected.id)
      : null;
  }, [clipDraft, manipulable, selected]);
  const enabled = Boolean(appliedId);
  const { beginUndoGroup, endUndoGroup } = usePoseCreatorClipUndoGrouping();
  const manipulation = useAvatarEffectManipulation({
    containerRef,
    stateRef,
    enabled,
    attachment: attachment ?? NO_ATTACHMENT,
    target: {
      beginGroup: () => {
        gestureRef.current = null;
        beginUndoGroup();
      },
      // Each patch is the whole change since the gesture began, so it
      // applies to the override the event had then.
      apply: (patch: AvatarEffectEditorAttachmentPatch) => {
        if (!source || !selected || !appliedId) return;
        const result = editAvatarEffectUse(
          source.definition,
          selected.override,
          { action: { type: "patch-attachment", patch } },
        );
        if ("error" in result) return;
        gestureRef.current = { override: result.override };
        const transform = avatarEffectUseTransform(
          source.definition,
          result.override,
        );
        if (transform)
          activeAvatar?.vfxController?.updateEffectTransform(
            appliedId,
            transform,
          );
      },
      endGroup: () => {
        const gesture = gestureRef.current;
        gestureRef.current = null;
        if (
          gesture &&
          !sameAvatarEffectOverride(gesture.override, selected?.override)
        )
          updateSelectedClipEvent({ override: gesture.override ?? null });
        endUndoGroup();
      },
    },
  });
  return {
    enabled,
    onKeyDown: manipulation.onKeyDown,
    // Mounted only while a use can be dragged: the overlay is sized to the
    // stage at device pixel density and redrawn every frame.
    overlay: enabled ? (
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 z-30 size-full"
        aria-hidden="true"
        data-testid="action-editor-effect-handles"
      />
    ) : null,
    renderer: enabled ? (
      <AvatarEffectHandleRenderer
        avatar={activeAvatar}
        appliedId={appliedId}
        enabled={enabled}
        canvasRef={canvasRef}
        stateRef={stateRef}
      />
    ) : null,
  };
}
