import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", () => ({ savePose: mocks.save }));
import { savePoseContent } from "./usePoseContentActions";
import { preparePoseSaveAttempt } from "@/lib/content/poseContent";
const pose = {
  schema: "animaPose/1.0" as const,
  id: "draft",
  name: "Rest",
  humanoid: {},
};
beforeEach(() => vi.resetAllMocks());
describe("Pose saves", () => {
  it("retries exactly after response loss and sends the originally loaded revision", async () => {
    const attempt = preparePoseSaveAttempt({
      name: "Rest",
      pose,
      identity: {
        itemId: "item",
        poseId: "local:pose:rest",
        revision: "loaded",
      },
    });
    mocks.save.mockRejectedValueOnce(new Error("Connection lost"));
    await expect(savePoseContent(attempt.input)).rejects.toThrow();
    mocks.save.mockResolvedValue({
      data: { item_id: "item", revision_sha256: "saved" },
      error: undefined,
    });
    expect(await savePoseContent(attempt.input)).toMatchObject({
      revision_sha256: "saved",
    });
    const first = mocks.save.mock.calls[0][0];
    expect(mocks.save.mock.calls[1][0]).toEqual(first);
    expect(first.body).toMatchObject({
      operation_id: attempt.input.operationId,
      catalog_item_id: "item",
      expected_revision: "loaded",
    });
    expect(JSON.parse(first.body.descriptor_json)).toMatchObject({
      content_id: "local:pose:rest",
      pose: { id: "local:pose:rest" },
    });
  });
  it("preserves revision-conflict detail for a recoverable draft error", async () => {
    mocks.save.mockResolvedValue({
      error: { detail: { code: "catalog_revision_conflict" } },
      response: new Response(null, { status: 409 }),
    });
    const attempt = preparePoseSaveAttempt({ name: "Rest", pose });
    await expect(savePoseContent(attempt.input)).rejects.toMatchObject({
      status: 409,
      code: "catalog_revision_conflict",
    });
  });
});
