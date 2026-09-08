import { describe, expect, it, vi } from "vitest";

import {
  contentPreviewFileUrl,
  contentPreviewLeaseIsFresh,
  contentPreviewPrimaryFile,
  fetchContentPreviewFile,
} from "./contentPreview";

describe("contentPreview", () => {
  it("requires enough authorization lease for delayed playback", () => {
    const now = Date.parse("2026-08-21T12:00:00Z");
    expect(contentPreviewLeaseIsFresh("2026-08-21T12:02:00Z", now)).toBe(true);
    expect(contentPreviewLeaseIsFresh("2026-08-21T12:00:30Z", now)).toBe(false);
    expect(contentPreviewLeaseIsFresh(undefined, now)).toBe(false);
  });

  it("uses opaque preview membership handles", () => {
    const preview = {
      preview_id: "preview/id",
      revision: "ready digest",
      revision_sha256: "ready digest",
      expires_at: "2026-08-10T00:00:00Z",
      metadata: {},
      files: [
        {
          file_ref: "opaque-ref",
          role: "audio",
          ordinal: 1,
          filename: "ding.ogg",
          media_type: "audio/ogg",
          size_bytes: 1,
          sha256: "a".repeat(64),
          url: "/v1/content/previews/preview/files/opaque-ref",
        },
      ],
    };
    expect(contentPreviewPrimaryFile(preview, "audio")?.file_ref).toBe(
      "opaque-ref",
    );
    expect(contentPreviewFileUrl(preview, preview.files[0]!)).toContain(
      "preview%2Fid/revisions/ready%20digest/files/opaque-ref",
    );
  });

  it("downloads a registered preview through the gateway without bearer headers", async () => {
    const response = new Response("sound");
    const fetcher = vi.fn<typeof fetch>(async () => response);

    await expect(
      fetchContentPreviewFile(
        { preview_id: "preview-id", revision: "revision-id" },
        { file_ref: "file-ref" },
        { fetcher },
      ),
    ).resolves.toBe(response);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining(
        "/v1/content/previews/preview-id/revisions/revision-id/files/file-ref",
      ),
      expect.objectContaining({
        cache: "no-cache",
        credentials: "same-origin",
        redirect: "error",
      }),
    );
    expect(
      new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("Authorization"),
    ).toBe(false);
  });
});
