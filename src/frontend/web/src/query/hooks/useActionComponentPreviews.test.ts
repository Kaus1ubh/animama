import { describe, expect, it } from "vitest";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import {
  actionComponentPreviewDigest,
  actionComponentPreviewNeedsRenewal,
  actionComponentPreviewRefreshInterval,
  actionComponentPreviewRequestRoots,
} from "./useActionComponentPreviews";

describe("actionComponentPreviewRefreshInterval", () => {
  it("refreshes active preview leases before authorization expires", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    const preview = {
      expires_at: "2026-08-21T12:05:00Z",
    } as PyContentPreview;

    expect(actionComponentPreviewRefreshInterval(preview, now)).toBe(240_000);
    expect(
      actionComponentPreviewRefreshInterval(preview, now + 4 * 60 * 1000),
    ).toBe(15_000);
  });

  it("uses a bounded fallback when a lease timestamp is absent", () => {
    expect(actionComponentPreviewRefreshInterval(undefined, 0)).toBe(120_000);
  });

  it("renews on focus only after the active lease enters its expiry margin", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    const preview = {
      expires_at: "2026-08-21T12:05:00Z",
    } as PyContentPreview;

    expect(actionComponentPreviewNeedsRenewal(preview, now)).toBe(false);
    expect(
      actionComponentPreviewNeedsRenewal(preview, now + 4 * 60 * 1000),
    ).toBe(true);
  });

  it("collapses repeated aliases into one canonical batch root", () => {
    const dependencies = ["burst", "echo"].map((alias) => ({
      alias,
      content_type: "sound_effect" as const,
      source: {
        type: "builtin" as const,
        content_id: "builtin:sfx:chime",
        version: 1,
      },
      config: {},
    }));

    expect(actionComponentPreviewRequestRoots(dependencies)).toHaveLength(1);
    expect(actionComponentPreviewDigest(dependencies)).toBe(
      "builtin:sound_effect:builtin:sfx:chime@1",
    );
  });
});
