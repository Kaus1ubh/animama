import { describe, expect, it } from "vitest";

import { previewWithDisplayPath } from "./display-path";

describe("previewWithDisplayPath", () => {
  const preview = {
    operation: "update" as const,
    path: "animas/anima-1/IDENTITY.md",
    summary: "Update `animas/anima-1/IDENTITY.md`.",
    unified_diff:
      "--- a/animas/anima-1/IDENTITY.md\n+++ b/animas/anima-1/IDENTITY.md\n@@ -1 +1 @@\n-old\n+new\n",
  };

  it("replaces the model-facing identity path everywhere it is shown", () => {
    const shown = previewWithDisplayPath(preview, "Animas/Annie/IDENTITY.md");

    expect(shown.path).toBe("Animas/Annie/IDENTITY.md");
    expect(shown.summary).toBe("Update `Animas/Annie/IDENTITY.md`.");
    expect(shown.unified_diff).toContain("--- a/Animas/Annie/IDENTITY.md");
    expect(shown.unified_diff).not.toContain("anima-1");
  });

  it("leaves previews without a distinct label unchanged", () => {
    expect(previewWithDisplayPath(preview, undefined)).toBe(preview);
    expect(previewWithDisplayPath(preview, preview.path)).toBe(preview);
  });
});
