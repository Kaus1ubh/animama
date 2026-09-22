import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyPose } from "@animama/runtime-contracts/api-types";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), fetchFile: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  previewPose: mocks.preview,
}));
vi.mock("./contentPreview", () => ({
  fetchContentPreviewFile: mocks.fetchFile,
}));
import { loadPoseContent, preparePoseSaveAttempt } from "./poseContent";
const item: PyPose = {
  item_id: "item",
  name: "Rest",
  source: "local",
  editable: true,
  pose_id: "local:pose:rest",
  logical_key: "local:pose:rest",
  revision_sha256: "loaded-revision",
};
const pose = {
  schema: "animaPose/1.0",
  id: item.pose_id,
  name: item.name,
  humanoid: { head: { rotation: [0, 0, 0, 1] } },
};
function preview(revision = item.revision_sha256) {
  return {
    data: {
      item: { ...item, kind: "pose", revision_sha256: revision },
      preview_id: "lease",
      revision_sha256: "lease-revision",
      files: [{ file_ref: "descriptor", role: "descriptor", size_bytes: 200 }],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.preview.mockResolvedValue(preview());
  mocks.fetchFile.mockResolvedValue(
    new Response(
      JSON.stringify({
        schema_version: 1,
        content_type: "pose",
        content_id: item.pose_id,
        name: item.name,
        pose,
      }),
    ),
  );
});
describe("Pose registered byte loading", () => {
  it("loads effective values through the registered descriptor", async () => {
    expect(await loadPoseContent(item)).toEqual({ item, pose });
    expect(mocks.fetchFile.mock.calls[0][0]).toEqual({
      preview_id: "lease",
      revision: "lease-revision",
    });
  });
  it("rejects a changed revision before consuming its bytes", async () => {
    mocks.preview.mockResolvedValue(preview("newer-revision"));
    await expect(loadPoseContent(item)).rejects.toThrow(/changed/);
    expect(mocks.fetchFile).not.toHaveBeenCalled();
  });
  it("rejects descriptor identity mismatch", async () => {
    mocks.fetchFile.mockResolvedValue(
      new Response(
        JSON.stringify({
          schema_version: 1,
          content_type: "pose",
          content_id: "other",
          name: item.name,
          pose,
        }),
      ),
    );
    await expect(loadPoseContent(item)).rejects.toThrow(/identity/);
  });
});

describe("Pose retry identity", () => {
  it("reuses a new item's exact request after response loss without mutating the draft", () => {
    const draft = { name: "Rest", pose: structuredClone(pose) } as Parameters<
      typeof preparePoseSaveAttempt
    >[0];
    const first = preparePoseSaveAttempt(draft);
    const retry = preparePoseSaveAttempt(structuredClone(draft), first);
    expect(retry).toBe(first);
    expect(retry.input.pose.id).toMatch(/^local:pose:/);
    expect(draft.pose.id).toBe(item.pose_id);
    const changed = preparePoseSaveAttempt(
      { ...draft, name: "Rest edited" },
      first,
    );
    expect(changed.input.operationId).not.toBe(first.input.operationId);
    expect(first.input.name).toBe("Rest");
  });
  it("retains the loaded revision and identity for updates", () => {
    const attempt = preparePoseSaveAttempt({
      name: "Renamed",
      pose: pose as Parameters<typeof preparePoseSaveAttempt>[0]["pose"],
      identity: {
        itemId: item.item_id,
        poseId: item.pose_id,
        revision: item.revision_sha256,
      },
    });
    expect(attempt.input).toMatchObject({
      itemId: item.item_id,
      expectedRevision: "loaded-revision",
      pose: { id: item.pose_id, name: "Renamed" },
    });
  });
});
