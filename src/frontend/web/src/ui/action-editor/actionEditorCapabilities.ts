import type { AvatarPreviewCameraProfile } from "@/ui/avatar-preview/AvatarPreviewSurface";
import type { ActionDocument, ActionIntent } from "./actionDocument";

export type ActionEditorMode = "pose" | "clip" | "reaction" | "vrma";

export type ActionEditorCapabilities = {
  intent: ActionIntent;
  cameraProfile: AvatarPreviewCameraProfile;
  defaultMode: ActionEditorMode;
  allowedModes: readonly ActionEditorMode[];
  allowsHumanoid: boolean;
  allowsExpressions: boolean;
  allowsDependencies: boolean;
};

const CAPABILITIES: Record<ActionIntent, ActionEditorCapabilities> = {
  gesture: {
    intent: "gesture",
    cameraProfile: "full-body",
    defaultMode: "pose",
    allowedModes: ["pose", "clip", "vrma"],
    allowsHumanoid: true,
    allowsExpressions: true,
    allowsDependencies: true,
  },
  reaction: {
    intent: "reaction",
    cameraProfile: "portrait",
    defaultMode: "reaction",
    allowedModes: ["reaction"],
    allowsHumanoid: false,
    allowsExpressions: true,
    allowsDependencies: true,
  },
};

/** Product capability boundary; hidden Reaction tools remain invalid in data. */
export function actionEditorCapabilities(
  intent: ActionIntent,
): ActionEditorCapabilities {
  return CAPABILITIES[intent];
}

/** Choose the initial workspace for a new Action and any component handoff. */
export function newActionEditorMode(
  intent: ActionIntent,
  initialComponent?: string,
): ActionEditorMode {
  if (intent === "gesture" && initialComponent) return "clip";
  return actionEditorCapabilities(intent).defaultMode;
}

/** Loaded documents open without entering an inline pose edit or changing keyframes. */
export function loadedActionEditorMode(
  intent: ActionIntent,
  implementation: ActionDocument["implementation"],
): ActionEditorMode {
  if (implementation === "vrma") return "vrma";
  return intent === "gesture" ? "clip" : "reaction";
}
