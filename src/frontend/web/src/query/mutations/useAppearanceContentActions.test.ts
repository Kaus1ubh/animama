import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  save: vi.fn(),
}));

vi.mock("@/lib/content/contentUploads", () => ({
  preflightContentFile: mocks.preflight,
}));

vi.mock("@/lib/content/catalogApi", () => ({
  saveCatalogItem: mocks.save,
}));

import { saveAppearanceImage } from "./useAppearanceContentActions";

describe("saveAppearanceImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.preflight.mockResolvedValue({ sourceFormat: "png", error: null });
    mocks.save.mockResolvedValue({
      item_id: "image-1",
      source: "local",
      scope: "owner",
      kind: "appearance",
      relative_locator: "appearances/portrait.png",
      logical_key: "local:appearance:portrait",
      display_name: "Portrait",
      name: "Portrait",
      description: null,
      semantic_key: null,
      implementation_kind: null,
      status: "valid",
      revision_sha256: "a".repeat(64),
      dependencies: [],
      provenance: {},
      metadata: {},
      diagnostics: [],
      files: [],
      scanned_at: "2026-08-21T00:00:00Z",
      origin: "local",
      editable: true,
      selection: {
        type: "catalog",
        catalog_item_id: "image-1",
        logical_key: "local:appearance:portrait",
      },
    });
  });

  it("writes one ordinary image and readable sidecar through the catalog", async () => {
    const progress = vi.fn();
    const file = new File(["png"], "portrait.png", { type: "image/png" });
    const result = await saveAppearanceImage({
      name: "Portrait",
      file,
      uses: ["profile", "background"],
      operationId: "appearance-op",
      onProgress: progress,
    });

    expect(result.itemId).toBe("image-1");
    expect(mocks.save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "appearance",
        entryName: "Portrait",
        files: [file],
        operationId: "appearance-op",
        metadata: expect.objectContaining({
          id: "local:appearance:portrait",
          supported_uses: ["profile", "background"],
        }),
      }),
    );
    expect(progress).toHaveBeenLastCalledWith({
      stage: "processing",
      percent: null,
    });
  });

  it("does not write when local image validation fails", async () => {
    mocks.preflight.mockResolvedValueOnce({
      sourceFormat: null,
      error: "Unsupported image",
    });
    await expect(
      saveAppearanceImage({
        name: "Portrait",
        file: new File(["bad"], "portrait.txt"),
        uses: ["profile"],
      }),
    ).rejects.toThrow("Unsupported image");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
