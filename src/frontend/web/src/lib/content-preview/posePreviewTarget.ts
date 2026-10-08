import type { PyPose } from "@animama/runtime-contracts/api-types";
import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  parseAnimaPoseClip,
  type AnimaPoseClipRotationKey,
  type AnimaPoseClipScalarKey,
} from "@/lib/avatar/poses/animaPoseClip";
import { loadPoseContent } from "@/lib/content/poseContent";
import type { RuntimeCatalogEntry } from "@/lib/runtime-content/types";
import type { ContentPreviewTarget } from "./types";

type PosePreviewTarget = Extract<
  ContentPreviewTarget,
  { sourceType: "pose_content" }
>;

/** Open the dock immediately; exact registered bytes are admitted during preparation. */
export function posePreviewTarget(item: PyPose): PosePreviewTarget {
  return {
    key: `pose:${item.item_id}:${item.revision_sha256}`,
    sourceType: "pose_content",
    item,
    // Standalone Pose IDs can equal equipped Gesture IDs; the isolated clip owns its lane identity.
    kind: "anima_pose_clip",
    slot: "pose",
    runtimeId: `pose-preview:${item.item_id}`,
    displayName: item.name,
    versionLabel: item.source === "included" ? "Starter Pose" : "Local Pose",
    configSchemaVersion: 1,
    config: {},
  };
}

/** Adapt a verified, parent-free Pose to the existing disposable clip preview player. */
export async function resolvePosePreviewTarget(
  target: PosePreviewTarget,
  signal?: AbortSignal,
): Promise<Extract<ContentPreviewTarget, { sourceType: "resolved_entry" }>> {
  const { pose } = await loadPoseContent(target.item, signal);
  signal?.throwIfAborted();
  // One held beat. Bone positions other than the hips, which a 2.0 clip
  // cannot key, do not preview.
  const beat = "held";
  const rotations: Record<string, AnimaPoseClipRotationKey[]> = {};
  for (const [bone, transform] of Object.entries(pose.humanoid ?? {}))
    if (transform?.rotation)
      rotations[bone] = [{ beat, q: transform.rotation }];
  const hips = pose.humanoid?.hips?.position;
  const scalar = (v: number): AnimaPoseClipScalarKey[] => [{ beat, v }];
  const expressions = Object.fromEntries(
    Object.entries(pose.expressions ?? {}).map(([name, weight]) => [
      name,
      scalar(weight),
    ]),
  );
  const clip = parseAnimaPoseClip({
    schema: ANIMA_POSE_CLIP_V2_SCHEMA,
    id: target.runtimeId,
    name: target.displayName,
    duration: 1,
    loop: true,
    beats: [{ id: beat, label: "Held", time: 0 }],
    ...(Object.keys(rotations).length > 0 ? { rotations } : {}),
    ...(hips
      ? {
          hipsPosition: {
            x: scalar(hips[0]),
            y: scalar(hips[1]),
            z: scalar(hips[2]),
          },
        }
      : {}),
    ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
  });
  const json = JSON.stringify(clip);
  const entry: RuntimeCatalogEntry = {
    slot: "pose",
    runtime_id: target.runtimeId,
    kind: "anima_pose_clip",
    display_name: target.displayName,
    description: target.item.description ?? null,
    config_schema_version: 1,
    config: {},
    content_revision: target.item.revision_sha256,
    source: {
      type: "authorized_files",
      files: [
        {
          role: "sequence",
          ordinal: 1,
          filename: "pose-preview.json",
          content_type: "application/json",
          size_bytes: new TextEncoder().encode(json).byteLength,
          content_revision: `${target.item.revision_sha256}:static`,
          // Same local inline-sequence boundary used by unsaved Action previews.
          url: `data:application/json;charset=utf-8,${encodeURIComponent(json)}`,
        },
      ],
    },
  };
  return { ...target, sourceType: "resolved_entry", entry };
}
