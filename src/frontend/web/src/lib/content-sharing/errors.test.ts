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
});
