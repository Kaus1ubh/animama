import { getI18n } from "react-i18next";
import type { Client } from "@animama/runtime-contracts/sdk";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { previewPose } from "@animama/runtime-contracts/sdk";
import {
  parseAnimaPose,
  cloneAnimaPose,
  type AnimaPose,
  type ResolvedAnimaPose,
} from "@/lib/avatar/poses/animaPose";
import { PreviewByteSession } from "@/lib/runtime-content/PreviewByteSession";
import { contentPreviewFileUrl } from "./contentPreview";
import { WordedError } from "@/lib/errors/apiError";

export type PoseContentDocument = { item: PyPose; pose: ResolvedAnimaPose };

/** Read the registered descriptor bytes for a selected Pose. */
export async function loadPoseContent(
  apiClient: Client,
  item: PyPose,
  signal?: AbortSignal,
): Promise<PoseContentDocument> {
  const t = getI18n().getFixedT(null, "library");
  const { data: preview } = await previewPose({
    client: apiClient,
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
    throw new WordedError(t("content.pose.changed"));
  }
  const file = preview.files.find(
    (candidate) => candidate.role === "descriptor",
  );
  if (!file) throw new WordedError(t("content.pose.descriptorUnavailable"));
  const session = await PreviewByteSession.prepare(
    {
      preview_id: preview.preview_id,
      revision: preview.revision_sha256,
      revision_sha256: preview.revision_sha256,
      expires_at: preview.expires_at,
      metadata: {},
      files: [
        {
          ...file,
          url: contentPreviewFileUrl(
            {
              preview_id: preview.preview_id,
              revision: preview.revision_sha256,
            },
            file,
          ),
        },
      ],
    },
    { signal, maxTotalBytes: 1024 * 1024 },
  );
  try {
    const prepared = session.files.get(file.file_ref);
    if (!prepared)
      throw new WordedError(t("content.pose.descriptorUnavailable"));
    const raw: unknown = JSON.parse(await prepared.blob.text());
    if (!raw || typeof raw !== "object")
      throw new WordedError(t("content.pose.descriptorInvalid"));
    const descriptor = raw as Record<string, unknown>;
    if (
      descriptor.schema_version !== 1 ||
      descriptor.content_type !== "pose" ||
      descriptor.content_id !== item.pose_id ||
      descriptor.name !== item.name
    ) {
      throw new WordedError(t("content.pose.descriptorMismatch"));
    }
    const pose = parseAnimaPose(descriptor.pose);
    if (pose.id !== item.pose_id || pose.name !== item.name)
      throw new WordedError(t("content.pose.payloadMismatch"));
    signal?.throwIfAborted();
    if (pose.parent) throw new WordedError(t("content.pose.notSelfContained"));
    return { item, pose };
  } finally {
    // The resolved values are copied in memory; descriptor URLs never outlive admission.
    session.dispose();
  }
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
  const t = getI18n().getFixedT(null, "library");
  const name = draft.name.trim();
  if (!name) throw new WordedError(t("content.pose.nameRequired"));
  if (draft.pose.parent)
    throw new WordedError(t("content.pose.resolveBeforeSaving"));
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
