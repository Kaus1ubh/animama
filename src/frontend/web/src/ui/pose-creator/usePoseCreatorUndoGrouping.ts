"use client";

import { useCallback, useEffect, useRef } from "react";

import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  beginPoseCreatorDraftUndoGroup,
  endPoseCreatorDraftUndoGroup,
  type PoseCreatorDraftUndoGroup,
} from "./poseCreatorUndo";

/** Keep a continuous FK/expression control interaction to one Undo entry. */
export function usePoseCreatorUndoGrouping() {
  const activeGroupRef = useRef<PoseCreatorDraftUndoGroup | null>(null);

  const beginUndoGroup = useCallback(() => {
    if (activeGroupRef.current) return;
    activeGroupRef.current = beginPoseCreatorDraftUndoGroup();
  }, []);

  const endUndoGroup = useCallback(() => {
    const group = activeGroupRef.current;
    if (!group) return;
    activeGroupRef.current = null;
    endPoseCreatorDraftUndoGroup(group);
  }, []);

  useEffect(() => endUndoGroup, [endUndoGroup]);

  return { beginUndoGroup, endUndoGroup };
}

/** Keep a continuous Clip timeline/inspector interaction to one Undo entry. */
export function usePoseCreatorClipUndoGrouping() {
  const activeRef = useRef(false);

  const beginUndoGroup = useCallback(() => {
    if (activeRef.current) return;
    activeRef.current = true;
    usePoseCreatorStore.getState().beginClipUndoGroup();
  }, []);

  const endUndoGroup = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    usePoseCreatorStore.getState().endClipUndoGroup();
  }, []);

  useEffect(() => endUndoGroup, [endUndoGroup]);

  return { beginUndoGroup, endUndoGroup };
}
