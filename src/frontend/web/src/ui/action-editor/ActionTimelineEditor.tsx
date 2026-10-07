"use client";

import { useEffect, useMemo, useRef } from "react";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import { parseAnyAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { ANIMA_POSE_CLIP_V2_SCHEMA } from "@/lib/avatar/poses/animaPoseClip/schemaV2";
import { sanitizeAnimaPoseClipLayerMutes } from "@/lib/avatar/poses/animaPoseClip/schema";
import { PoseCreatorClipTimeline } from "@/ui/pose-creator/PoseCreatorClipTimeline";
import { cn } from "@/lib/utils";
import {
  getPoseCreatorClipExtraFields,
  type PoseCreatorClipDraftPatch,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { sanitizeReactionSequence } from "./actionDocument";
import { actionSequenceFromTimelineDraft } from "./actionPersistence";

export function shouldHydrateActionTimeline(
  serialized: string,
  lastReceived: string,
): boolean {
  return serialized !== lastReceived;
}

/** A title edit must not replace the active inline pose or its undo history. */
export function syncActionTimelineMetadata(
  sequence: Record<string, unknown>,
  previous: Record<string, unknown> | null,
): boolean {
  if (
    !previous ||
    typeof sequence.id !== "string" ||
    typeof sequence.name !== "string" ||
    JSON.stringify({ ...sequence, id: null, name: null }) !==
      JSON.stringify({ ...previous, id: null, name: null })
  ) {
    return false;
  }
  usePoseCreatorStore.getState().updateClipDraft({
    id: sequence.id,
    name: sequence.name,
  });
  return true;
}

/** Empty typed action documents intentionally have no playable clip yet. */
export function isEmptyActionTimeline(
  sequence: Record<string, unknown>,
): boolean {
  if (sequence.schema === ANIMA_POSE_CLIP_V2_SCHEMA)
    return (
      Array.isArray(sequence.beats) &&
      sequence.beats.length === 0 &&
      (!Array.isArray(sequence.events) || sequence.events.length === 0)
    );
  const poses = sequence.poses;
  const keyframes = sequence.poseKeyframes;
  const events = sequence.events;
  return (
    poses !== null &&
    poses !== undefined &&
    typeof poses === "object" &&
    !Array.isArray(poses) &&
    Object.keys(poses).length === 0 &&
    Array.isArray(keyframes) &&
    keyframes.length === 0 &&
    (!Array.isArray(events) || events.length === 0)
  );
}

/** Preserve local seek state only while editing the same loaded document. */
export function shouldPreserveTimelinePlayhead(
  previousSession: number | null,
  currentSession: number,
): boolean {
  return previousSession !== null && previousSession === currentSession;
}

/** Skip only the stale render captured immediately before store hydration. */
export function shouldSkipActionTimelineEmission<T>(
  draft: T,
  staleDraft: T | null,
): boolean {
  return staleDraft !== null && draft === staleDraft;
}

/** Ignore hydration normalization until the first authored change, then retire it. */
export function consumeActionTimelineHydrationBaseline(
  serializedDraft: string,
  baseline: { current: string | null },
): boolean {
  if (serializedDraft === baseline.current) return true;
  baseline.current = null;
  return false;
}

/** Keep typed documents synchronized with the existing timeline and undo store. */
export function ActionTimelineDocumentSync({
  sequence,
  session,
  reaction,
  onChange,
  onHistoryGroupStart,
  onHistoryGroupEnd,
}: {
  sequence: Record<string, unknown>;
  /** Increments when New, Load, or Import starts another authoring session. */
  session: number;
  reaction: boolean;
  onChange: (sequence: Record<string, unknown>) => void;
  onHistoryGroupStart?: () => void;
  onHistoryGroupEnd?: () => void;
}) {
  const hydrate = usePoseCreatorStore((state) => state.hydrateClipDocument);
  const resetClipDraft = usePoseCreatorStore((state) => state.resetClipDraft);
  const draft = usePoseCreatorStore((state) => state.clipDraft);
  const undoGroup = usePoseCreatorStore((state) => state.undoGroup);
  const lastReceived = useRef("");
  const lastReceivedSequence = useRef<Record<string, unknown> | null>(null);
  const lastEmitted = useRef("");
  const hydratedDraftBaseline = useRef<string | null>(null);
  const lastTimelineSession = useRef<number | null>(null);
  const staleDraftBeforeHydration = useRef<typeof draft | null>(null);
  const groupActive = useRef(false);
  const editorSequence = useMemo(
    () => (reaction ? sanitizeReactionSequence(sequence) : sequence),
    [reaction, sequence],
  );
  const serialized = JSON.stringify(editorSequence);

  useEffect(() => {
    if (undoGroup && !groupActive.current) {
      groupActive.current = true;
      onHistoryGroupStart?.();
      return;
    }
    if (!undoGroup && groupActive.current) {
      groupActive.current = false;
      onHistoryGroupEnd?.();
    }
  }, [onHistoryGroupEnd, onHistoryGroupStart, undoGroup]);

  useEffect(
    () => () => {
      if (groupActive.current) onHistoryGroupEnd?.();
    },
    [onHistoryGroupEnd],
  );

  useEffect(() => {
    // Store-only edits (such as changing an inline expression keyframe) cause
    // this component to render before the updated sequence reaches the typed
    // document. Re-hydrating the unchanged prop here would overwrite the edit
    // before the draft-to-document effect can emit it.
    if (!shouldHydrateActionTimeline(serialized, lastReceived.current)) return;
    const recordHydratedBaseline = () => {
      const hydrated = actionSequenceFromTimelineDraft(
        usePoseCreatorStore.getState().clipDraft,
        reaction ? "reaction" : "gesture",
        { allowEmpty: true },
      );
      hydratedDraftBaseline.current = hydrated
        ? JSON.stringify(hydrated)
        : null;
    };
    const previousSequence = lastReceivedSequence.current;
    lastReceivedSequence.current = editorSequence;
    lastReceived.current = serialized;
    // Suppress only the immediate acknowledgement of a local store edit. Keeping
    // this value after Undo would mistake Redo for an echo and leave the old
    // store draft to overwrite the restored document (and its dependencies).
    const acknowledgesLocalEdit = serialized === lastEmitted.current;
    lastEmitted.current = "";
    if (acknowledgesLocalEdit) return;
    const preservePlayhead = shouldPreserveTimelinePlayhead(
      lastTimelineSession.current,
      session,
    );
    const currentTimeSec =
      usePoseCreatorStore.getState().clipDraft.currentTimeSec;
    lastTimelineSession.current = session;
    if (
      preservePlayhead &&
      syncActionTimelineMetadata(editorSequence, previousSequence)
    ) {
      staleDraftBeforeHydration.current = draft;
      recordHydratedBaseline();
      return;
    }
    if (isEmptyActionTimeline(editorSequence)) {
      staleDraftBeforeHydration.current = draft;
      resetClipDraft(
        typeof editorSequence.name === "string"
          ? editorSequence.name
          : undefined,
      );
      // Empty authoring sequences retain their settings through Undo/Redo even
      // though the runtime clip parser correctly rejects an unplayable clip.
      const settings: PoseCreatorClipDraftPatch = { basePose: "" };
      for (const key of ["id", "name", "basePose"] as const) {
        const value = editorSequence[key];
        if (typeof value === "string") settings[key] = value;
      }
      if (typeof editorSequence.duration === "number")
        settings.duration = editorSequence.duration;
      settings.loop = editorSequence.loop === true;
      if (
        editorSequence.defaultTransition &&
        typeof editorSequence.defaultTransition === "object"
      )
        settings.defaultTransition =
          editorSequence.defaultTransition as PoseCreatorClipDraftPatch["defaultTransition"];
      for (const key of ["fadeIn", "fadeOut"] as const) {
        const value = editorSequence[key];
        if (value && typeof value === "object")
          settings[key] = value as PoseCreatorClipDraftPatch[typeof key];
      }
      const mutes = sanitizeAnimaPoseClipLayerMutes(
        editorSequence.mutedProceduralLayers,
      );
      if (mutes) settings.mutedProceduralLayers = mutes;
      settings.extraFields = getPoseCreatorClipExtraFields(editorSequence);
      usePoseCreatorStore.getState().updateClipDraft(settings);
      recordHydratedBaseline();
      // The reset is the successful hydration for an intentionally blank
      // document. Suppress the same render's stale pre-reset draft emission.
      return;
    }
    try {
      if (
        hydrate(parseAnyAnimaPoseClip(editorSequence), {
          ...(preservePlayhead ? { currentTimeSec } : {}),
        })
      ) {
        // Hydration updates Zustand after this render. Do not immediately emit
        // the stale pre-hydration draft back over the typed document.
        staleDraftBeforeHydration.current = draft;
        recordHydratedBaseline();
      }
    } catch {
      // Keep the last valid timeline while imported JSON is being repaired.
    }
  }, [
    draft,
    editorSequence,
    hydrate,
    reaction,
    resetClipDraft,
    serialized,
    session,
  ]);

  useEffect(() => {
    if (
      shouldSkipActionTimelineEmission(draft, staleDraftBeforeHydration.current)
    ) {
      // StrictMode can replay this effect with the same pre-hydration render.
      // Keep rejecting that draft until a fresh store snapshot actually renders.
      return;
    }
    staleDraftBeforeHydration.current = null;
    const nextClip = actionSequenceFromTimelineDraft(
      draft,
      reaction ? "reaction" : "gesture",
      { allowEmpty: true },
    );
    if (!nextClip) return;
    const next = JSON.stringify(nextClip);
    if (consumeActionTimelineHydrationBaseline(next, hydratedDraftBaseline))
      return;
    if (next === serialized) return;
    lastEmitted.current = next;
    onChange(nextClip);
  }, [draft, onChange, reaction, serialized]);

  return null;
}

/** Render one responsive view over the shared timeline editor store. */
export function ActionTimelineEditor({
  reaction,
  isBusy,
  playbackPending = false,
  settingsContent,
  transportActions,
  onHeightChange,
  expanded = true,
  onExpandedChange,
  variant = "workspace",
  className,
}: {
  reaction: boolean;
  isBusy: boolean;
  playbackPending?: boolean;
  settingsContent?: React.ReactNode;
  transportActions?: React.ReactNode;
  onHeightChange?: (height: number) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  variant?: "workspace" | "mobile";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-h-0 w-full overflow-hidden",
        variant === "workspace" && "h-full rounded-xl",
        variant === "mobile" && "h-full",
        className,
      )}
      aria-busy={isBusy || undefined}
    >
      <PoseCreatorClipTimeline
        variant={variant}
        poseLaneLabel={reaction ? "Expression" : "Pose"}
        allowHumanoid={!reaction}
        playbackPending={playbackPending}
        settingsContent={settingsContent}
        transportActions={transportActions}
        onHeightChange={onHeightChange}
        expanded={expanded}
        onExpandedChange={onExpandedChange}
      />
    </div>
  );
}
