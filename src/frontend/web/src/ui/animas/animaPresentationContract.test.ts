import { describe, expect, it } from "vitest";

import { zPyRuntimeImageReference } from "@animama/runtime-contracts/validators";

/** The Anima list's profile thumbnail, as the browser validates it. */
function thumbnail(size: number) {
  return {
    source_type: "catalog",
    url: "/v1/content/files/portrait",
    content_type: "image/webp",
    width: size,
    height: size,
    content_revision: "a".repeat(64),
    presentation: { fit: "cover", focal_x: 0.5, focal_y: 0.5, zoom: 1 },
  };
}

describe("Anima presentation thumbnails", () => {
  it("accept the 512-square Avatar portraits", () => {
    expect(zPyRuntimeImageReference.safeParse(thumbnail(512)).success).toBe(
      true,
    );
  });

  it("stay bounded", () => {
    expect(zPyRuntimeImageReference.safeParse(thumbnail(513)).success).toBe(
      false,
    );
  });
});
