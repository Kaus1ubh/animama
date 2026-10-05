import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { parseAnimaPose } from "@/lib/avatar/poses/animaPose";
import compatibilityPose from "@/lib/avatar/poses/fixtures/content-compatibility-valid.json";
import { ContentSaveApiError } from "./contentSaveErrors";

const clientMocks = vi.hoisted(() => ({
  saveGesture: vi.fn(),
  savePose: vi.fn(),
  previewPose: vi.fn(),
}));

vi.mock("@animama/runtime-contracts/sdk", async (original) => ({
  ...(await original<typeof import("@animama/runtime-contracts/sdk")>()),
  saveGesture: clientMocks.saveGesture,
  savePose: clientMocks.savePose,
  previewPose: clientMocks.previewPose,
}));

import { previewCatalogItem, saveCatalogItem } from "./catalogApi";

describe("saveCatalogItem error boundary", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("unwraps the generated client's successful fields response", async () => {
    clientMocks.saveGesture.mockResolvedValue({
      data: {
        item_id: "gesture-item",
        source: "local",
        logical_key: "local:gesture:wave",
        name: "Wave",
        description: null,
        dependencies: [],
        files: [],
        revision_sha256: "gesture-revision",
        editable: true,
        semantic_key: "wave",
        implementation: { kind: "anima_clip" },
        config: {},
      },
      request: new Request("http://localhost/v1/gestures/wave"),
      response: new Response(null, { status: 200 }),
    });

    await expect(
      saveCatalogItem(testApiClient, {
        kind: "gesture",
        entryName: "Wave",
        files: [],
        operationId: "save-operation",
      }),
    ).resolves.toMatchObject({
      item_id: "gesture-item",
      revision_sha256: "gesture-revision",
    });
  });

  it("retains HTTP status while normalizing a generated-client error body", async () => {
    clientMocks.saveGesture.mockResolvedValue({
      data: undefined,
      error: { detail: { code: "catalog_revision_conflict" } },
      request: new Request("http://localhost/v1/gestures/wave"),
      response: new Response(null, { status: 409 }),
    });

    const save = saveCatalogItem(testApiClient, {
      kind: "gesture",
      entryName: "Wave",
      files: [],
      operationId: "save-operation",
    });

    await expect(save).rejects.toMatchObject({
      name: "ContentSaveApiError",
      status: 409,
      code: "catalog_revision_conflict",
      message:
        "This item changed since you opened it. Reload the latest version before saving. Your draft is preserved.",
    });
    expect(clientMocks.saveGesture).toHaveBeenCalledWith(
      expect.objectContaining({ throwOnError: false }),
    );
  });

  it("normalizes a browser fetch rejection at the same boundary", async () => {
    clientMocks.saveGesture.mockRejectedValue(new TypeError("Failed to fetch"));

    const save = saveCatalogItem(testApiClient, {
      kind: "gesture",
      entryName: "Wave",
      files: [],
      operationId: "save-operation",
    });

    await expect(save).rejects.toEqual(
      expect.objectContaining<Partial<ContentSaveApiError>>({
        name: "ContentSaveApiError",
        status: null,
        message:
          "Animama could not be reached. Check that the local stack is running, then retry. Your draft is preserved.",
      }),
    );
  });

  it("preserves a recoverable Save failure when the generated client has no HTTP response", async () => {
    // throwOnError:false returns a rejected fetch as a result, rather than throwing.
    clientMocks.saveGesture.mockResolvedValue({
      data: undefined,
      error: new TypeError("Failed to fetch"),
      response: undefined,
    });
    await expect(
      saveCatalogItem(testApiClient, {
        kind: "gesture",
        entryName: "Wave",
        files: [],
        operationId: "save-operation",
      }),
    ).rejects.toMatchObject({
      name: "ContentSaveApiError",
      status: null,
      message: expect.stringContaining("Your draft is preserved"),
    });
  });
});

describe("Pose catalog transport", () => {
  it("consumes the shared backend Pose fixture without dropping static values", () => {
    expect(parseAnimaPose(compatibilityPose.pose)).toEqual(
      compatibilityPose.pose,
    );
  });

  const pose = {
    kind: "pose" as const,
    item_id: "pose-item",
    source: "local" as const,
    logical_key: "local:pose:salute",
    name: "Salute",
    revision_sha256: "pose-revision",
    editable: true,
    pose_id: "local:pose:salute",
    dependencies: [],
    files: [],
  };

  it("saves through the Pose family and preserves its catalog identity", async () => {
    clientMocks.savePose.mockResolvedValue({
      data: pose,
      response: new Response(null, { status: 200 }),
    });
    const saved = await saveCatalogItem(testApiClient, {
      kind: "pose",
      entryName: "Salute",
      files: [],
      operationId: "save-pose",
      descriptor: { content_type: "pose" },
    });
    expect(saved).toMatchObject({
      kind: "pose",
      item_id: "pose-item",
      logical_key: "local:pose:salute",
      implementation_kind: null,
      metadata: { content_type: "pose", id: "local:pose:salute" },
    });
    expect(clientMocks.savePose).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { entry_name: "Salute" },
        body: expect.objectContaining({ operation_id: "save-pose" }),
      }),
    );
  });

  it("previews Pose content through its typed endpoint", async () => {
    clientMocks.previewPose.mockResolvedValue({
      data: {
        preview_id: "pose-preview",
        revision_sha256: "pose-revision",
        expires_at: "2026-09-22T00:00:00Z",
        item: pose,
        files: [],
      },
    });
    await expect(
      previewCatalogItem(testApiClient, "pose-item", undefined, "pose"),
    ).resolves.toMatchObject({
      item: { kind: "pose", item_id: "pose-item" },
      metadata: { content_type: "pose", id: "local:pose:salute" },
    });
  });
});
