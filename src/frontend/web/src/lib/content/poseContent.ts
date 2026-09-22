import type { PyPose } from "@animama/runtime-contracts/api-types";
import { previewPose } from "@animama/runtime-contracts/sdk";
import {
  parseAnimaPose,
  cloneAnimaPose,
  type AnimaPose,
  type ResolvedAnimaPose,
} from "@/lib/avatar/poses/animaPose";
import { readBoundedJsonResponse } from "@/lib/runtime-content/runtimeContentDelivery";
import { fetchContentPreviewFile } from "./contentPreview";

export type PoseContentDocument = { item: PyPose; pose: ResolvedAnimaPose };

/** Read the registered descriptor bytes for a selected Pose. */
export async function loadPoseContent(
  item: PyPose,
  signal?: AbortSignal,
): Promise<PoseContentDocument> {
  const { data: preview } = await previewPose({
    path: { item_id: item.item_id },
    signal,
    responseValidator: undefined,
    throwOnError: true,
  });
  if (
    preview.item.kind !== "pose" ||
    preview.item.item_id !== item.item_id ||
    preview.item.revision_sha256 !== item.revision_sha256
  ) {
    throw new Error(
      "This Pose changed since it was selected. Refresh and try again.",
    );
  }
  const file = preview.files.find(
    (candidate) => candidate.role === "descriptor",
  );
  if (!file) throw new Error("The Pose descriptor is unavailable.");
  const response = await fetchContentPreviewFile(
    { preview_id: preview.preview_id, revision: preview.revision_sha256 },
    file,
    { signal },
  );
  if (!response.ok) throw new Error("Could not load the Pose content.");
  const raw = await readBoundedJsonResponse(response, 1024 * 1024);
  if (!raw || typeof raw !== "object")
    throw new Error("Invalid Pose descriptor.");
  const descriptor = raw as Record<string, unknown>;
  if (
    descriptor.schema_version !== 1 ||
    descriptor.content_type !== "pose" ||
    descriptor.content_id !== item.pose_id ||
    descriptor.name !== item.name
  ) {
    throw new Error(
      "The Pose descriptor identity does not match the selected content.",
    );
  }
  const pose = parseAnimaPose(descriptor.pose);
  if (pose.id !== item.pose_id || pose.name !== item.name)
    throw new Error("The Pose payload identity does not match its descriptor.");
  signal?.throwIfAborted();
  if (pose.parent) throw new Error("Saved Poses must be self-contained.");
  return { item, pose };
}

export type PoseSavedIdentity = {
  itemId: string;
  poseId: string;
  logicalKey: string | null;
  revision: string;
  name: string;
};

/** Keep the revision that was actually loaded, rather than refreshing it on Save. */
export function poseSavedIdentity(item: PyPose): PoseSavedIdentity {
  return {
    itemId: item.item_id,
    poseId: item.pose_id,
    logicalKey: item.logical_key ?? null,
    revision: item.revision_sha256,
    name: item.name,
  };
}

export type PoseSaveInput = {
  operationId: string;
  name: string;
  pose: AnimaPose;
  itemId?: string;
  expectedRevision?: string;
};
export type PoseSaveAttempt = { fingerprint: string; input: PoseSaveInput };

/** Reuse an immutable request after an ambiguous failure; new edits receive a new operation. */
export function preparePoseSaveAttempt(
  draft: {
    name: string;
    pose: AnimaPose;
    identity?: Pick<PoseSavedIdentity, "itemId" | "poseId" | "revision"> | null;
  },
  previous?: PoseSaveAttempt | null,
): PoseSaveAttempt {
  const name = draft.name.trim();
  if (!name) throw new Error("Give the Pose a name before saving.");
  if (draft.pose.parent) throw new Error("Resolve the Pose before saving it.");
  const fingerprint = JSON.stringify({
    name,
    pose: draft.pose,
    identity: draft.identity ?? null,
  });
  if (previous?.fingerprint === fingerprint) return previous;
  const id = draft.identity?.poseId ?? `local:pose:${crypto.randomUUID()}`;
  return {
    fingerprint,
    input: {
      operationId: crypto.randomUUID(),
      name,
      pose: { ...cloneAnimaPose(draft.pose), id, name },
      ...(draft.identity
        ? {
            itemId: draft.identity.itemId,
            expectedRevision: draft.identity.revision,
          }
        : {}),
    },
  };
}
