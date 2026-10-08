import type {
  AvatarEffectEditorAttachment,
  AvatarEffectEditorAttachmentKind,
  AvatarEffectEditorDocument,
} from "./types";
import { AVATAR_EFFECT_EDITOR_SCHEMA } from "./types";

/**
 * A new attachment of one kind. Values the runtime defaults are left out, as
 * stored `/2` definitions leave them out.
 */
export function defaultAvatarEffectAttachment(
  kind: AvatarEffectEditorAttachmentKind,
): AvatarEffectEditorAttachment {
  switch (kind) {
    case "face_surface":
      return {
        kind,
        part: "face_skin",
        area: "blush",
        layout: "single",
        side: "left",
        mirror: true,
        pivot: "center",
      };
    case "face_landmark":
      return { kind, landmark: "eyes", side: "right", mirror: true };
    case "body":
      return { kind, bone: "chest", offset: { x: 0, y: 0, z: 0.12 } };
    case "sticker":
      return { kind, around: "head", offset: { x: 0.18, y: 0.05 } };
    case "silhouette":
      return { kind, fill: "pattern" };
  }
}

/** A blank document: art in front of both eyes, mirrored. */
export function createDefaultAvatarEffectDocument(): AvatarEffectEditorDocument {
  return {
    schema: AVATAR_EFFECT_EDITOR_SCHEMA,
    name: "",
    description: "",
    region: "eyes",
    regionMode: "automatic",
    attachment: defaultAvatarEffectAttachment("face_landmark"),
    art: { image: null, otherEyeImage: null, flipbook: null },
    appearance: { opacity: 1, tint: null, blend: "normal" },
    motion: {},
    faceOptions: {},
    sound: null,
  };
}
