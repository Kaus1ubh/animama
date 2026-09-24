import type { AvatarEffectEditorDocument } from "./types";
import { AVATAR_EFFECT_EDITOR_SCHEMA } from "./types";

export function createDefaultAvatarEffectDocument(): AvatarEffectEditorDocument {
  return {
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    name: "",
    description: "",
    kind: "hover",
    region: "eyes",
    regionMode: "automatic",
    transform: {
      offset: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    animationConfig: null,
    lifetime: null,
    image: null,
    sound: null,
    hover: {
      hoverKind: "eye_hover",
      placement: "forehead-middle",
      side: null,
      requiresMirror: true,
      skinBackdrop: true,
      forceBlink: true,
      autoDisableEyeMaterials: true,
      faceCleanup: true,
      disableTargetRoles: [],
    },
    face: {
      anchor: "undereye",
      faceCleanup: true,
      layout: "single",
      pivot: "center",
      side: "left",
      requiresMirror: true,
    },
    texture: {
      targetRole: "face_skin",
      disableTargetRoles: [],
      assetShape: "full_face",
      applyMode: "overlay",
      side: null,
      requiresMirror: false,
    },
  };
}
