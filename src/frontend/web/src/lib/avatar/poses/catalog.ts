import rawCatalog from "./pose_catalog.json";
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
  parseAnimaPoseClip,
  type AnimaPoseClip,
} from "./animaPoseClip";

export const RELAXED_REST_POSE_ID = "relaxedRest" as const;

const logger = createLogger("AvatarPoseCatalog");

type PoseCatalogEntry = {
  id: string;
  source: string;
};

type PoseCatalogManifest = {
  schema: "animaPoseCatalog/1.0";
  defaultPoseIds: string[];
  poses: PoseCatalogEntry[];
  clips: PoseCatalogEntry[];
};

const rawPoseModules = import.meta.glob("./json/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const rawClipModules = import.meta.glob("./json/clips/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const rawReactionClipModules = import.meta.glob(
  "./json/clips/reactions/*.json",
  {
    eager: true,
    import: "default",
  },
) as Record<string, unknown>;

const manifest = parsePoseCatalogManifest(rawCatalog);
const loadedPoseCatalog = pruneUnresolvablePoseCatalog(
  loadPoseCatalog(manifest),
);

export const AVATAR_POSE_CATALOG: Readonly<Record<string, AnimaPose>> =
  Object.freeze(loadedPoseCatalog);

export const AVATAR_POSE_CLIP_CATALOG: Readonly<Record<string, AnimaPoseClip>> =
  Object.freeze(loadPoseClipCatalog(manifest, AVATAR_POSE_CATALOG));

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
  resolveDefaultAvatarPoseIds(manifest.defaultPoseIds, AVATAR_POSE_CATALOG),
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

export function getAvatarPoseClip(clipId: string): AnimaPoseClip {
  const normalizedClipId = normalizeAvatarPoseClipId(clipId);
  const clip = AVATAR_POSE_CLIP_CATALOG[normalizedClipId];
  if (!clip) {
    throw new Error(`Unknown avatar pose clip id "${clipId}"`);
  }
  return parseAnimaPoseClip(clip);
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

function loadPoseCatalog(
  catalogManifest: PoseCatalogManifest,
): Record<string, AnimaPose> {
  const catalog: Record<string, AnimaPose> = {};
  for (const entry of catalogManifest.poses) {
    if (catalog[entry.id]) {
      logger.warn("Pose", "Skipping duplicate avatar pose catalog entry", {
        poseId: entry.id,
        source: entry.source,
      });
      continue;
    }

    const rawPose = rawPoseModules[entry.source];
    if (!rawPose) {
      logger.warn("Pose", "Skipping missing avatar pose JSON source", {
        poseId: entry.id,
        source: entry.source,
      });
      continue;
    }

    let pose: AnimaPose;
    try {
      pose = parseAnimaPose(rawPose);
    } catch (error) {
      logger.warn("Pose", "Skipping invalid avatar pose JSON source", {
        poseId: entry.id,
        source: entry.source,
        error,
      });
      continue;
    }

    if (pose.id !== entry.id) {
      logger.warn("Pose", "Skipping avatar pose with mismatched id", {
        catalogPoseId: entry.id,
        source: entry.source,
        poseId: pose.id,
      });
      continue;
    }

    catalog[entry.id] = pose;
  }
  return catalog;
}

function loadPoseClipCatalog(
  catalogManifest: PoseCatalogManifest,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): Record<string, AnimaPoseClip> {
  const catalog: Record<string, AnimaPoseClip> = {};
  for (const entry of catalogManifest.clips) {
    if (catalog[entry.id]) {
      logger.warn("Clip", "Skipping duplicate avatar pose clip catalog entry", {
        clipId: entry.id,
        source: entry.source,
      });
      continue;
    }

    const rawClip = rawClipModules[entry.source];
    if (!rawClip) {
      logger.warn("Clip", "Skipping missing avatar pose clip JSON source", {
        clipId: entry.id,
        source: entry.source,
      });
      continue;
    }

    let clip: AnimaPoseClip;
    try {
      clip = parseAnimaPoseClip(rawClip);
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
  clip: AnimaPoseClip,
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
  clip: AnimaPoseClip,
  poseCatalog: Readonly<Record<string, AnimaPose>>,
): string[] {
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

function parsePoseCatalogManifest(value: unknown): PoseCatalogManifest {
  if (!isRecord(value) || value.schema !== "animaPoseCatalog/1.0") {
    throw new Error("Invalid avatar pose catalog manifest");
  }
  if (!Array.isArray(value.defaultPoseIds) || !Array.isArray(value.poses)) {
    throw new Error("Invalid avatar pose catalog entries");
  }
  if (value.clips !== undefined && !Array.isArray(value.clips)) {
    throw new Error("Invalid avatar pose clip catalog entries");
  }

  return {
    schema: value.schema,
    defaultPoseIds: value.defaultPoseIds.map(parseCatalogString),
    poses: parsePoseCatalogEntries(value.poses, "pose"),
    clips: parsePoseCatalogEntries(value.clips ?? [], "clip"),
  };
}

function parsePoseCatalogEntries(
  value: unknown[],
  kind: "pose" | "clip",
): PoseCatalogEntry[] {
  const entries: PoseCatalogEntry[] = [];
  for (const entry of value) {
    const parsedEntry = parsePoseCatalogEntry(entry, kind);
    if (parsedEntry) {
      entries.push(parsedEntry);
    }
  }
  return entries;
}

function parsePoseCatalogEntry(
  value: unknown,
  kind: "pose" | "clip",
): PoseCatalogEntry | null {
  if (!isRecord(value)) {
    logger.warn("Manifest", "Skipping invalid avatar catalog entry", { kind });
    return null;
  }

  const id = sanitizeCatalogString(value.id);
  const source = sanitizeCatalogString(value.source);
  if (!id || !source) {
    logger.warn("Manifest", "Skipping invalid avatar catalog entry", {
      kind,
      id: typeof value.id === "string" ? value.id : null,
      source: typeof value.source === "string" ? value.source : null,
    });
    return null;
  }

  return { id, source };
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

function parseCatalogString(value: unknown): string {
  const sanitized = sanitizeCatalogString(value);
  if (!sanitized) {
    throw new Error("Invalid avatar pose catalog string");
  }
  return sanitized;
}

function sanitizeCatalogString(value: unknown): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
