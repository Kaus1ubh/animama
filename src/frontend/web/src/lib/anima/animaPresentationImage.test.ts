import { describe, expect, it, vi } from "vitest";
import type { PyRuntimeImageReference } from "@/lib/content/catalogTypes";
import {
  createAnimaPresentationObjectUrl,
  resolveAnimaPresentationImageRequest,
} from "./animaPresentationImage";

function reference(
  overrides: Partial<PyRuntimeImageReference>,
): PyRuntimeImageReference {
  return {
    source_type: "catalog",
    url: "/v1/content/files/file-ref",
    content_type: "image/webp",
    width: 256,
    height: 256,
    content_revision: "a".repeat(64),
    presentation: { fit: "cover", focal_x: 0.5, focal_y: 0.5, zoom: 1 },
    ...overrides,
  };
}

describe("Anima presentation image delivery", () => {
  const gatewayOrigin = "https://app.animama.test/v1-client";

  it("routes an Included portrait through the local gateway", () => {
    expect(
      resolveAnimaPresentationImageRequest(reference({}), gatewayOrigin),
    ).toEqual({
      url: "https://app.animama.test/v1/content/files/file-ref",
      requiresPrivateFetch: true,
    });
  });

  it("routes a catalog image through the local gateway", () => {
    expect(
      resolveAnimaPresentationImageRequest(
        reference({
          source_type: "catalog",
          url: "/v1/content/files/file-ref",
        }),
        gatewayOrigin,
      ),
    ).toEqual({
      url: "https://app.animama.test/v1/content/files/file-ref",
      requiresPrivateFetch: true,
    });
  });

  it("preserves an absolute protected URL", () => {
    expect(
      resolveAnimaPresentationImageRequest(
        reference({ url: "https://static.animama.test/model.webp" }),
        gatewayOrigin,
      ),
    ).toEqual({
      url: "https://static.animama.test/model.webp",
      requiresPrivateFetch: true,
    });
  });

  it("revokes a private Blob URL exactly once", () => {
    const createObjectURL = vi.fn(() => "blob:portrait");
    const revokeObjectURL = vi.fn();
    const lease = createAnimaPresentationObjectUrl(new Blob(["portrait"]), {
      createObjectURL,
      revokeObjectURL,
    });

    expect(lease.url).toBe("blob:portrait");
    lease.release();
    lease.release();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:portrait");
  });
});
