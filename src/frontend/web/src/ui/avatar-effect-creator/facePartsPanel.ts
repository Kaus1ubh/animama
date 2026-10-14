import type { AvatarFacePartCorrection } from "@animama/runtime-contracts/api-types";
import { getI18n } from "react-i18next";

import {
  AVATAR_FACE_PARTS_SCHEMA,
  AVATAR_FACE_PART_ROLES,
  isFacePartEdited,
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

/** The display name of a face part, as the panel and its messages name it. */
export function facePartRoleName(role: AvatarFacePartRole): string {
  const t = getI18n().getFixedT(null, "effects");
  switch (role) {
    case "face_skin":
      return t("faceParts.roles.face_skin");
    case "eye_left":
      return t("faceParts.roles.eye_left");
    case "eye_right":
      return t("faceParts.roles.eye_right");
    case "eye_highlight":
      return t("faceParts.roles.eye_highlight");
    case "eyeline":
      return t("faceParts.roles.eyeline");
    case "eyelash":
      return t("faceParts.roles.eyelash");
    case "hair":
      return t("faceParts.roles.hair");
  }
}

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

/** Status rows for every part of the Avatar's current part map. */
export function facePartRows(
  map: AvatarFacePartMap,
  primitives: readonly FacePartPrimitive[],
  draft: FacePartDraft = {},
): FacePartRow[] {
  const t = getI18n().getFixedT(null, "effects");
  const nameOf = (key: string) =>
    primitives.find((primitive) => primitive.key === key)?.name ?? key;
  return AVATAR_FACE_PART_ROLES.map((role) => {
    const saved = map.parts[role];
    // A saved correction pins the required parts; one the user left as
    // detected keeps showing its detection.
    const part =
      saved.source === "corrected" && !isFacePartEdited(saved) && saved.detected
        ? saved.detected
        : saved;
    const edited = draft[role];
    const keys = edited ?? saved.bindings;
    let status: FacePartStatus;
    let statusLabel: string;
    if (edited) {
      status = edited.length ? "corrected" : "missing";
      statusLabel = edited.length
        ? t("faceParts.status.changed")
        : t("faceParts.status.absent");
    } else if (part.source === "corrected") {
      status = "corrected";
      statusLabel = t("faceParts.status.corrected");
    } else if (part.source === "missing" || !part.bindings.length) {
      status = "missing";
      statusLabel = t("faceParts.status.missing");
    } else if (
      part.source === "names" ||
      part.confidence < UNCERTAIN_CONFIDENCE
    ) {
      status = "uncertain";
      statusLabel =
        part.source === "names"
          ? t("faceParts.status.foundByName", { confidence: part.confidence })
          : t("faceParts.status.uncertain", { confidence: part.confidence });
    } else {
      status = "detected";
      statusLabel = t("faceParts.status.detected", {
        confidence: part.confidence,
      });
    }
    return {
      role,
      label: facePartRoleName(role),
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
  const t = getI18n().getFixedT(null, "effects");
  if (!vrmSha256) return t("faceParts.problems.noDigest");
  const known = new Set(primitiveKeys);
  if (Object.values(draft).some((keys) => keys?.some((key) => !known.has(key))))
    return t("faceParts.problems.unknownMesh");
  for (const role of REQUIRED_FACE_PARTS) {
    if (!(draft[role] ?? map.parts[role].bindings).length)
      return t("faceParts.problems.required", { part: facePartRoleName(role) });
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
