import { useCallback, useEffect, useRef, useState } from "react";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  resolveHandBones,
  type HandAdjustment,
  type HandPreset,
  type HandTarget,
} from "@/lib/avatar/poses/anatomy/handPresets";
import { createHandInteractionController } from "./poseCreatorHandInteraction";

/** Workspace-owned state survives responsive panel mounts without persisting in poses. */
export function usePoseCreatorHands(enabled: boolean) {
  const avatar = usePoseCreatorStore((state) => state.activeAvatar);
  const modelKey = usePoseCreatorStore((state) => state.selectedSource?.key);
  const loadStatus = usePoseCreatorStore((state) => state.loadStatus);
  const mode = usePoseCreatorStore((state) => state.authoringMode);
  const poseToken = usePoseCreatorStore((state) => state.poseSessionToken);
  const clipToken = usePoseCreatorStore((state) => state.clipSessionToken);
  const inlineIdentity = usePoseCreatorStore(
    (state) => state.clipInlineEdit?.originalPose,
  );
  const historyRevision = usePoseCreatorStore(
    (state) => state.historyRequestRevision,
  );
  const controller = useRef<ReturnType<
    typeof createHandInteractionController
  > | null>(null);
  const [open, setOpenState] = useState(false);
  const [target, setTargetState] = useState<HandTarget>("left");
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState(0);
  const [adjustment, setAdjustment] = useState<HandAdjustment | null>(null);
  const active = useRef<HandAdjustment | null>(null);
  // The inline keyframe editor keeps the owning store in Clip mode.
  const poseEditing = mode === "pose" || Boolean(inlineIdentity);
  const canEdit =
    enabled && poseEditing && loadStatus === "ready" && Boolean(avatar);

  useEffect(() => {
    const instance = createHandInteractionController();
    controller.current = instance;
    return () => {
      instance.dispose();
      if (controller.current === instance) controller.current = null;
    };
  }, []);
  const end = useCallback(() => {
    controller.current?.end();
    active.current = null;
    setValue(0);
    setAdjustment(null);
  }, []);
  useEffect(() => {
    controller.current?.end();
    active.current = null;
    setValue(0);
    setAdjustment(null);
    setSelected([]);
    setTargetState("left");
    setError(null);
    setOpenState(false);
  }, [modelKey, poseToken, clipToken, inlineIdentity]);
  // Responsive canvas remounts replace the runtime instance, not the chosen
  // model. End stale gestures but keep the workspace's panel and selection.
  useEffect(() => {
    end();
  }, [avatar, end]);
  useEffect(() => {
    if (!canEdit) {
      controller.current?.end();
      active.current = null;
      setValue(0);
      setAdjustment(null);
    }
    if (!enabled || !poseEditing) setOpenState(false);
  }, [canEdit, enabled, poseEditing]);
  useEffect(() => {
    active.current = null;
    setValue(0);
    setAdjustment(null);
  }, [historyRevision]);
  const availability = resolveHandBones(avatar, target);
  const selectedAvailable = availability.available.filter((bone) =>
    selected.includes(bone.segment.id),
  );
  return {
    open,
    target,
    selected,
    canEdit,
    error,
    value,
    adjustment,
    ...availability,
    selectedAvailable,
    setOpen(next: boolean) {
      end();
      setOpenState(next && enabled && poseEditing);
    },
    setTarget(next: HandTarget) {
      end();
      setTargetState(next);
      setError(null);
    },
    toggleSegment(id: string) {
      end();
      if (
        !canEdit ||
        !availability.available.some((bone) => bone.segment.id === id)
      )
        return;
      setSelected((previous) =>
        previous.includes(id)
          ? previous.filter((item) => item !== id)
          : [...previous, id],
      );
    },
    begin(next: HandAdjustment) {
      if (active.current === next) return true;
      end();
      if (!canEdit || !controller.current) return false;
      const success = controller.current.begin(target, selected, next);
      setError(controller.current.lastError);
      if (success) {
        active.current = next;
        setAdjustment(next);
      }
      return success;
    },
    update(next: number) {
      if (!active.current || !controller.current) return;
      if (controller.current.update(next)) setValue(next);
      else {
        setError(controller.current.lastError);
        end();
      }
    },
    end,
    preset(preset: HandPreset) {
      end();
      if (!canEdit || !controller.current) return;
      controller.current.preset(target, preset);
      setError(controller.current.lastError);
    },
  };
}
export type PoseCreatorHands = ReturnType<typeof usePoseCreatorHands>;
