import { describe, expect, it } from "vitest";

import { SharingError, sharingMessage } from "./errors";

describe("package sharing errors", () => {
  it("names the retired clip format when an import is refused for it", () => {
    expect(new SharingError("clip_format_unsupported", 409).message).toBe(
      sharingMessage("clip_format_unsupported"),
    );
    expect(sharingMessage("clip_format_unsupported")).toContain(
      "retired animaPoseClip/1.0",
    );
  });

  it("names the Scene Effects whose emoji items block an export", () => {
    expect(
      new SharingError("scene_emoji_item_removed", 409, ["Old sparkles"])
        .message,
    ).toMatch(/no longer provides.*sticker or image.*: Old sparkles\.$/);
    // An import has no item names and asks the exporter to fix the package.
    const importMessage = new SharingError("scene_emoji_item_removed", 409)
      .message;
    expect(importMessage).toMatch(/can't be imported/);
    expect(importMessage).toMatch(/Ask whoever exported it.*export again\.$/);
    expect(importMessage).not.toMatch(/Open each/);
  });
});
