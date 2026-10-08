import generatedPoses from "./pose_catalog.generated.json";
import { createLogger } from "@/lib/logger";
import { isTrackedEmotion } from "@/lib/emotion";
import {
  cloneAnimaPose,
  parseAnimaPose,
  resolveAnimaPose,
  type AnimaPose,
  type ResolvedAnimaPose,
} from "./animaPose";
import {
  analyzeAnimaPoseClipChannels,
  isAnimaPoseClipRef,
  isAnimaPoseClipV2,
  parseAnimaPoseClip,
  parseAnimaPoseClipV2,
  type AnimaPoseClip,
  type AnyAnimaPoseClip,
} from "./animaPoseClip";

export const RELAXED_REST_POSE_ID = "relaxedRest" as const;

const logger = createLogger("AvatarPoseCatalog");

type PoseCatalogEntry = {
  id: string;
  source: string;
};

/**
 * Included Gesture and Reaction clips, bundled straight from the canonical
 * `content/included` tree (each entry's sequence file is
 * `<folder>/<folder>.json`; metadata files and motion-preview review notes
 * are excluded so neither is bundled). The backend serves
 * the same files at runtime; this synchronous copy backs the creators,
 * previews and runtime-catalog fallbacks.
 */
const rawClipModules = import.meta.glob(
  [
    "../../../../../../../content/included/gestures/*/*.json",
    "!../../../../../../../content/included/gestures/*/*.meta.json",
    "!../../../../../../../content/included/gestures/*/*.review.json",
  ],
  { eager: true, import: "default" },
) as Record<string, unknown>;

const rawReactionClipModules = import.meta.glob(
  [
    "../../../../../../../content/included/reactions/*/*.json",
    "!../../../../../../../content/included/reactions/*/*.meta.json",
    "!../../../../../../../content/included/reactions/*/*.review.json",
  ],
  { eager: true, import: "default" },
) as Record<string, unknown>;

// Runtime-only dependencies resolve shipped Gesture refs without becoming Library content.
const rawInternalPoseModules = import.meta.glob(
  "./json/internal-poses/*.json",
  {
    eager: true,
    import: "default",
  },
) as Record<string, unknown>;
const internalPoses = Object.fromEntries(
  Object.entries(rawInternalPoseModules).map(([source, pose]) => [
    source.slice(source.lastIndexOf("/") + 1, -".json".length),
    pose,
  ]),
);

const loadedPoseCatalog = pruneUnresolvablePoseCatalog(
  loadPoseCatalog({ ...internalPoses, ...generatedPoses.poses }),
);

export const AVATAR_POSE_CATALOG: Readonly<Record<string, AnimaPose>> =
  Object.freeze(loadedPoseCatalog);

/** Built-in Gesture clips; 1.0 clips may reference internal poses, 2.0 clips are self-contained. */
export const AVATAR_POSE_CLIP_CATALOG: Readonly<
  Record<string, AnyAnimaPoseClip>
> = Object.freeze(loadPoseClipCatalog(rawClipModules, AVATAR_POSE_CATALOG));

export const AVATAR_REACTION_CLIP_CATALOG: Readonly<
  Record<string, AnimaPoseClip>
> = Object.freeze(
  loadReactionClipCatalog(rawReactionClipModules, AVATAR_POSE_CATALOG),
);

export const AVATAR_POSE_IDS: readonly string[] = Object.freeze(
  Object.keys(AVATAR_POSE_CATALOG),
);

export const AVATAR_POSE_CLIP_IDS: readonly string[] = Object.freeze(
  Object.keys(AVATAR_POSE_CLIP_CATALOG),
);

export const AVATAR_REACTION_CLIP_IDS: readonly string[] = Object.freeze(
  Object.keys(AVATAR_REACTION_CLIP_CATALOG),
);

export const DEFAULT_AVATAR_POSE_IDS: readonly string[] = Object.freeze(
  resolveDefaultAvatarPoseIds([RELAXED_REST_POSE_ID], AVATAR_POSE_CATALOG),
);

const resolvedAvatarPoseCache = new Map<string, ResolvedAnimaPose>();
for (const poseId of AVATAR_POSE_IDS) {
  try {
    getCachedResolvedAvatarPose(poseId);
  } catch (error) {
    logger.warn("Pose", "Skipping unresolved avatar pose cache warmup", {
      poseId,
      error,
    });
  }
}

export function getAvatarPose(poseId: string): AnimaPose {
  const pose = AVATAR_POSE_CATALOG[poseId];
  if (!pose) {
    throw new Error(`Unknown avatar pose id "${poseId}"`);
  }
  return cloneAnimaPose(pose);
}

export function getResolvedAvatarPose(poseId: string): ResolvedAnimaPose {
  return cloneAnimaPose(
    getCachedResolvedAvatarPose(poseId),
  ) as ResolvedAnimaPose;
}

export function getAvatarPoseClip(clipId: string): AnyAnimaPoseClip {
  const normalizedClipId = normalizeAvatarPoseClipId(clipId);
  const clip = AVATAR_POSE_CLIP_CATALOG[normalizedClipId];
  if (!clip) {
    throw new Error(`Unknown avatar pose clip id "${clipId}"`);
  }
  return parseCatalogClip(clip);
}

export function getAvatarReactionClip(clipId: string): AnimaPoseClip {
  const normalizedClipId = normalizeAvatarPoseClipId(clipId);
  const clip = AVATAR_REACTION_CLIP_CATALOG[normalizedClipId];
  if (!clip) {
    throw new Error(`Unknown avatar reaction clip id "${clipId}"`);
  }
  return parseAnimaPoseClip(clip);
}

export function hasAvatarPoseClip(clipId: string): boolean {
  return normalizeAvatarPoseClipId(clipId) in AVATAR_POSE_CLIP_CATALOG;
}

export function hasAvatarReactionClip(clipId: string): boolean {
  return normalizeAvatarPoseClipId(clipId) in AVATAR_REACTION_CLIP_CATALOG;
}

export function normalizeAvatarPoseClipId(clipId: string): string {
  const trimmed = clipId.trim();
  return trimmed.endsWith("-clip")
    ? trimmed.slice(0, -"-clip".length)
    : trimmed;
}

/** Load Included pose projections and immutable internal Gesture dependencies. */
function loadPoseCatalog(
  rawPoses: Readonly<Record<string, unknown>>,
): Record<string, AnimaPose> {
  const catalog: Record<string, AnimaPose> = {};
  for (const [poseId, rawPose] of Object.entries(rawPoses)) {
    try {
      const pose = parseAnimaPose(rawPose);
      if (pose.id !== poseId) throw new Error("Projected Pose id mismatch");
      catalog[poseId] = pose;
    } catch (error) {
      logger.warn("Pose", "Skipping invalid runtime Pose", {
        poseId,
        error,
      });
    }
  }
  return catalog;
}

function loadPoseClipCatalog(
  rawModules: Readonly<Record<string, unknown>>,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): Record<string, AnyAnimaPoseClip> {
  const catalog: Record<string, AnyAnimaPoseClip> = {};
  for (const source of Object.keys(rawModules).sort()) {
    const id = includedSequenceId(source);
    if (!id) continue;
    const entry: PoseCatalogEntry = { id, source };
    const rawClip = rawModules[source];

    let clip: AnyAnimaPoseClip;
    try {
      clip = parseCatalogClip(rawClip);
    } catch (error) {
      logger.warn("Clip", "Skipping invalid avatar pose clip JSON source", {
        clipId: entry.id,
        source: entry.source,
        error,
      });
      continue;
    }

    if (clip.id !== entry.id) {
      logger.warn("Clip", "Skipping avatar pose clip with mismatched id", {
        catalogClipId: entry.id,
        source: entry.source,
        clipId: clip.id,
      });
      continue;
    }

    warnForMissingClipPoseRefs(entry, clip, poseCatalog);
    catalog[entry.id] = clip;
  }
  return catalog;
}

/**
 * Parse a built-in clip of either schema into a fresh copy, so callers never
 * share (or mutate) the catalog's object. Unlike the cached
 * `parseAnyAnimaPoseClip`, this always sanitizes again, as 1.0 playback did.
 */
function parseCatalogClip(value: unknown): AnyAnimaPoseClip {
  return isAnimaPoseClipV2(value)
    ? parseAnimaPoseClipV2(value)
    : parseAnimaPoseClip(value);
}

function loadReactionClipCatalog(
  rawModules: Readonly<Record<string, unknown>>,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): Record<string, AnimaPoseClip> {
  const catalog: Record<string, AnimaPoseClip> = {};
  const sources = Object.keys(rawModules).sort();

  for (const source of sources) {
    const clipId = parseReactionClipSourceId(source);
    if (!clipId) {
      logger.warn(
        "ReactionClip",
        "Skipping reaction clip with unsupported file name",
        {
          source,
        },
      );
      continue;
    }

    if (catalog[clipId]) {
      logger.warn("ReactionClip", "Skipping duplicate reaction clip entry", {
        clipId,
        source,
      });
      continue;
    }

    let clip: AnimaPoseClip;
    try {
      clip = parseAnimaPoseClip(rawModules[source]);
    } catch (error) {
      logger.warn(
        "ReactionClip",
        "Skipping invalid reaction clip JSON source",
        {
          clipId,
          source,
          error,
        },
      );
      continue;
    }

    if (clip.id !== clipId) {
      logger.warn("ReactionClip", "Skipping reaction clip with mismatched id", {
        catalogClipId: clipId,
        source,
        clipId: clip.id,
      });
      continue;
    }

    const channelAnalysis = analyzeAnimaPoseClipChannels(
      clip,
      (poseId) => poseCatalog[poseId] ?? null,
    );
    if (channelAnalysis.humanoid) {
      logger.warn(
        "ReactionClip",
        "Skipping reaction clip with humanoid channels",
        {
          clipId,
          source,
        },
      );
      continue;
    }

    warnForMissingClipPoseRefs({ id: clipId, source }, clip, poseCatalog);
    catalog[clipId] = clip;
  }

  return catalog;
}

function pruneUnresolvablePoseCatalog(
  catalog: Record<string, AnimaPose>,
): Record<string, AnimaPose> {
  const prunedCatalog = { ...catalog };
  for (const [poseId, pose] of Object.entries(catalog)) {
    try {
      resolveAnimaPose(pose, (parentId) => prunedCatalog[parentId] ?? null);
    } catch (error) {
      logger.warn("Pose", "Skipping avatar pose with unresolved parent chain", {
        poseId,
        error,
      });
      delete prunedCatalog[poseId];
    }
  }
  return prunedCatalog;
}

function resolveDefaultAvatarPoseIds(
  poseIds: readonly string[],
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): string[] {
  const resolvedPoseIds: string[] = [];
  for (const poseId of poseIds) {
    if (poseCatalog[poseId]) {
      resolvedPoseIds.push(poseId);
      continue;
    }
    logger.warn("Pose", "Skipping unknown default avatar pose id", { poseId });
  }
  return resolvedPoseIds;
}

function warnForMissingClipPoseRefs(
  entry: PoseCatalogEntry,
  clip: AnyAnimaPoseClip,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): void {
  const missingPoseRefs = collectMissingClipPoseRefs(clip, poseCatalog);
  if (missingPoseRefs.length === 0) return;

  logger.warn("Clip", "Avatar pose clip references missing pose ids", {
    clipId: entry.id,
    source: entry.source,
    missingPoseRefs,
  });
}

function collectMissingClipPoseRefs(
  clip: AnyAnimaPoseClip,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): string[] {
  // 2.0 clips carry their own values and have no pose refs.
  if (isAnimaPoseClipV2(clip)) return [];
  const refs = new Set<string>();
  if (clip.basePose && !poseCatalog[clip.basePose]) {
    refs.add(clip.basePose);
  }
  for (const pose of Object.values(clip.poses)) {
    if (isAnimaPoseClipRef(pose) && !poseCatalog[pose.ref]) {
      refs.add(pose.ref);
    }
  }
  return [...refs];
}

function parseReactionClipSourceId(source: string): string | null {
  const filename = source.split("/").pop() ?? "";
  const match = /^([a-z_]+)-([1-3])\.json$/.exec(filename);
  if (!match || !isTrackedEmotion(match[1])) return null;
  return filename.slice(0, -".json".length);
}

/**
 * The Gesture or Reaction id of an Included sequence file
 * (`.../<folder>/<folder>.json`), or null for any other file in the folder.
 */
function includedSequenceId(source: string): string | null {
  const [folder, file] = source.split("/").slice(-2);
  return file === `${folder}.json` ? folder : null;
}

function getCachedResolvedAvatarPose(poseId: string): ResolvedAnimaPose {
  const cachedPose = resolvedAvatarPoseCache.get(poseId);
  if (cachedPose) return cachedPose;

  const pose = AVATAR_POSE_CATALOG[poseId];
  if (!pose) {
    throw new Error(`Unknown avatar pose id "${poseId}"`);
  }

  const resolvedPose = resolveAnimaPose(
    pose,
    (parentId) => AVATAR_POSE_CATALOG[parentId] ?? null,
  );
  resolvedAvatarPoseCache.set(poseId, resolvedPose);
  return resolvedPose;
}
