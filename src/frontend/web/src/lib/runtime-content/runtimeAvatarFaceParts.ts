import { zAvatarFacePartCorrection } from "@animama/runtime-contracts/validators";

import type { AvatarIssue } from "@/lib/avatar/diagnostics/issues";
import type { AvatarFacePartCorrections } from "@/lib/avatar/vfx/faceParts";
import { createLogger } from "@/lib/logger";

import { runtimeSourceHasFiles, type RuntimeCatalogEntry } from "./types";

const logger = createLogger("RuntimeAvatarFaceParts");

/** What `Avatar.load` needs to apply a saved face part correction. */
export type RuntimeAvatarFaceParts = {
  facePartCorrections: AvatarFacePartCorrections | null;
  vrmSha256: string | null;
};

/**
 * The Diagnostics finding for an Avatar entry's saved face part correction:
 * one that does not parse is dropped at load and reported here.
 */
export function runtimeAvatarFacePartIssues(
  entry: RuntimeCatalogEntry | null,
): AvatarIssue[] {
  const raw = entry?.config.face_parts;
  if (raw === undefined || raw === null) return [];
  return zAvatarFacePartCorrection.safeParse(raw).success
    ? []
    : [{ code: "face_parts_correction_invalid" }];
}

/**
 * Read the Avatar's effective face part correction (forwarded in the runtime
 * entry's config) and the sha256 of its VRM file. An invalid correction is
 * dropped with a warning; the Avatar still loads with detected parts.
 */
export function resolveRuntimeAvatarFaceParts(
  entry: RuntimeCatalogEntry | null,
): RuntimeAvatarFaceParts {
  if (!entry) return { facePartCorrections: null, vrmSha256: null };
  const raw = entry.config.face_parts;
  let facePartCorrections: AvatarFacePartCorrections | null = null;
  if (raw !== undefined && raw !== null) {
    const parsed = zAvatarFacePartCorrection.safeParse(raw);
    if (parsed.success) {
      facePartCorrections = parsed.data;
    } else {
      logger.warn("Load", "Ignored an invalid face part correction", {
        reason: "avatar_face_parts_invalid",
      });
    }
  }
  return { facePartCorrections, vrmSha256: runtimeAvatarModelSha256(entry) };
}

/**
 * The sha256 of an Avatar entry's VRM file, which `Avatar.load` uses to match
 * face part corrections and verified eyelid closure profiles.
 */
export function runtimeAvatarModelSha256(
  entry: RuntimeCatalogEntry | null | undefined,
): string | null {
  if (!entry) return null;
  const files = runtimeSourceHasFiles(entry.source) ? entry.source.files : [];
  const model =
    files.find((file) => file.role === "model") ??
    files.find((file) => file.filename.toLowerCase().endsWith(".vrm"));
  return model?.sha256 ?? null;
}
