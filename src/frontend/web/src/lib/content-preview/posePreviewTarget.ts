import type { Client } from "@animama/runtime-contracts/sdk";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
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
  apiClient: Client,
  target: PosePreviewTarget,
  signal?: AbortSignal,
): Promise<Extract<ContentPreviewTarget, { sourceType: "resolved_entry" }>> {
  const { pose } = await loadPoseContent(apiClient, target.item, signal);
  signal?.throwIfAborted();
  const clip = parseAnimaPoseClip({
    schema: "animaPoseClip/1.0",
    id: target.runtimeId,
    name: target.displayName,
    duration: 1,
    loop: true,
    poses: { held: { humanoid: pose.humanoid, expressions: pose.expressions } },
    poseKeyframes: [
      { time: 0, pose: "held" },
      { time: 1, pose: "held" },
    ],
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
