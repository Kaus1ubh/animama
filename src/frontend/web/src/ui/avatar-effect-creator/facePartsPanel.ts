import type { AvatarFacePartCorrection } from "@animama/runtime-contracts/api-types";

import {
  AVATAR_FACE_PARTS_SCHEMA,
  AVATAR_FACE_PART_ROLES,
  type AvatarFacePartMap,
  type AvatarFacePartRole,
} from "@/lib/avatar/vfx/faceParts";

/** Parts every correction names; the rest are optional. */
export const REQUIRED_FACE_PARTS: ReadonlySet<AvatarFacePartRole> = new Set([
  "face_skin",
  "eye_left",
  "eye_right",
]);

/** Below this, detected parts are shown as uncertain. */
export const UNCERTAIN_CONFIDENCE = 0.7;

export const FACE_PART_ROLE_NAMES: Record<AvatarFacePartRole, string> = {
  face_skin: "Face skin",
  eye_left: "Left eye",
  eye_right: "Right eye",
  eye_highlight: "Eye highlights",
  eyeline: "Eye lines",
  eyelash: "Eyelashes",
  hair: "Hair",
};

/** One mesh part of the Avatar, as the part list and picking name it. */
export type FacePartPrimitive = { key: string; name: string };

export type FacePartStatus = "detected" | "uncertain" | "corrected" | "missing";

export type FacePartRow = {
  role: AvatarFacePartRole;
  label: string;
  status: FacePartStatus;
  /** Plain status with the evidence, e.g. "Detected · 90%". */
  statusLabel: string;
  confidence: number;
  bindings: FacePartPrimitive[];
  required: boolean;
};

/** Edited bindings per part, before Save. */
export type FacePartDraft = Partial<Record<AvatarFacePartRole, string[]>>;

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** Status rows for every part of the Avatar's current part map. */
export function facePartRows(
  map: AvatarFacePartMap,
  primitives: readonly FacePartPrimitive[],
  draft: FacePartDraft = {},
): FacePartRow[] {
  const nameOf = (key: string) =>
    primitives.find((primitive) => primitive.key === key)?.name ?? key;
  return AVATAR_FACE_PART_ROLES.map((role) => {
    const part = map.parts[role];
    const edited = draft[role];
    const keys = edited ?? part.bindings;
    let status: FacePartStatus;
    let statusLabel: string;
    if (edited) {
      status = edited.length ? "corrected" : "missing";
      statusLabel = edited.length ? "Changed, not saved" : "Marked absent";
    } else if (part.source === "corrected") {
      status = "corrected";
      statusLabel = "Corrected";
    } else if (part.source === "missing" || !part.bindings.length) {
      status = "missing";
      statusLabel = "Missing";
    } else if (
      part.source === "names" ||
      part.confidence < UNCERTAIN_CONFIDENCE
    ) {
      status = "uncertain";
      statusLabel = `${part.source === "names" ? "Found by name" : "Detected"} · ${percent(part.confidence)}, check it`;
    } else {
      status = "detected";
      statusLabel = `Detected · ${percent(part.confidence)}`;
    }
    return {
      role,
      label: FACE_PART_ROLE_NAMES[role],
      status,
      statusLabel,
      confidence: part.confidence,
      bindings: keys.map((key) => ({ key, name: nameOf(key) })),
      required: REQUIRED_FACE_PARTS.has(role),
    };
  });
}

/** Add or remove one mesh part from a part, starting from its current bindings. */
export function toggleFacePartBinding(
  map: AvatarFacePartMap,
  draft: FacePartDraft,
  role: AvatarFacePartRole,
  key: string,
): FacePartDraft {
  const current = draft[role] ?? map.parts[role].bindings;
  return {
    ...draft,
    [role]: current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key],
  };
}

/** Why the draft cannot be saved, or null. */
export function facePartDraftProblem(
  map: AvatarFacePartMap,
  draft: FacePartDraft,
  vrmSha256: string | null,
  /** The current Avatar's mesh part keys; every corrected key must be one. */
  primitiveKeys: readonly string[],
): string | null {
  if (!vrmSha256)
    return "This Avatar's file digest is unavailable, so a correction cannot be saved.";
  const known = new Set(primitiveKeys);
  if (Object.values(draft).some((keys) => keys?.some((key) => !known.has(key))))
    return "The correction names mesh parts this Avatar does not have. Cancel and choose its parts again.";
  for (const role of REQUIRED_FACE_PARTS) {
    if (!(draft[role] ?? map.parts[role].bindings).length)
      return `Choose at least one mesh part for the ${FACE_PART_ROLE_NAMES[role].toLowerCase()}.`;
  }
  return null;
}

/**
 * The complete correction to save: required parts always, optional parts
 * when edited now or corrected before (so an untouched optional part keeps
 * following detection).
 */
export function facePartCorrection(args: {
  map: AvatarFacePartMap;
  draft: FacePartDraft;
  vrmSha256: string;
  previous: AvatarFacePartCorrection | null;
}): AvatarFacePartCorrection {
  const { map, draft, previous } = args;
  const bindings = (role: AvatarFacePartRole) => [
    ...new Set(draft[role] ?? map.parts[role].bindings),
  ];
  const parts: AvatarFacePartCorrection["parts"] = {
    face_skin: bindings("face_skin"),
    eye_left: bindings("eye_left"),
    eye_right: bindings("eye_right"),
  };
  for (const role of ["eye_highlight", "eyeline", "eyelash", "hair"] as const) {
    if (draft[role] || previous?.parts[role] != null)
      parts[role] = bindings(role);
  }
  return {
    schema: AVATAR_FACE_PARTS_SCHEMA as AvatarFacePartCorrection["schema"],
    vrm_sha256: args.vrmSha256,
    parts,
  };
}
