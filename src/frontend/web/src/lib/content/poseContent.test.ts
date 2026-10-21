import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PyPose } from "@animama/runtime-contracts/api-types";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), fetchFile: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  previewPose: mocks.preview,
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
const descriptor = {
  schema_version: 1,
  content_type: "pose",
  content_id: item.pose_id,
  name: item.name,
  pose,
};
function preview(revision = item.revision_sha256, payload = descriptor) {
  const bytes = JSON.stringify(payload);
  return {
    data: {
      item: { ...item, kind: "pose", revision_sha256: revision },
      preview_id: "lease",
      revision_sha256: "lease-revision",
      expires_at: "2099-01-01T00:00:00Z",
      files: [
        {
          file_ref: "descriptor",
          role: "descriptor",
          ordinal: 1,
          filename: "pose.json",
          media_type: "application/json",
          size_bytes: Buffer.byteLength(bytes),
          sha256: createHash("sha256").update(bytes).digest("hex"),
          url: "/v1/content/previews/lease/revisions/lease-revision/files/descriptor",
        },
      ],
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("fetch", mocks.fetchFile);
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
afterEach(() => vi.unstubAllGlobals());
describe("Pose registered byte loading", () => {
  it("rejects altered bytes and disposes descriptor URLs after parsing", async () => {
    const create = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await loadPoseContent(testApiClient, item);
    expect(revoke).toHaveBeenCalledWith(create.mock.results[0]?.value);
    // Altered on every read, so the one reload after a mismatch fails too.
    mocks.fetchFile.mockImplementation(
      async () =>
        new Response(JSON.stringify(descriptor).replace("Rest", "Best")),
    );
    await expect(loadPoseContent(testApiClient, item)).rejects.toThrow(
      /digest/,
    );
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRestore();
    revoke.mockRestore();
  });
  it("releases admitted bytes when the preview is cancelled before parsing completes", async () => {
    const abort = new AbortController();
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      abort.abort();
      return "blob:cancelled-pose";
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await expect(
      loadPoseContent(testApiClient, item, abort.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(revoke).toHaveBeenCalledWith("blob:cancelled-pose");
    create.mockRestore();
    revoke.mockRestore();
  });
  it("loads effective values through the registered descriptor", async () => {
    expect(await loadPoseContent(testApiClient, item)).toEqual({ item, pose });
    expect(mocks.fetchFile.mock.calls[0][0]).toBe(
      "/v1/content/previews/lease/revisions/lease-revision/files/descriptor",
    );
  });
  it("rejects a changed revision before consuming its bytes", async () => {
    mocks.preview.mockResolvedValue(preview("newer-revision"));
    await expect(loadPoseContent(testApiClient, item)).rejects.toThrow(
      /changed/,
    );
    expect(mocks.fetchFile).not.toHaveBeenCalled();
  });
  it("rejects descriptor identity mismatch", async () => {
    mocks.preview.mockResolvedValue(
      preview(item.revision_sha256, { ...descriptor, content_id: "other" }),
    );
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
    await expect(loadPoseContent(testApiClient, item)).rejects.toThrow(
      /identity/,
    );
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
