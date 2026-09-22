import type { AvatarPreviewCameraProfile } from "@/ui/avatar-preview/AvatarPreviewSurface";
import type { ActionIntent } from "./actionDocument";

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
    defaultMode: "clip",
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
