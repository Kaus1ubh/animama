import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import { PreviewByteSession } from "./PreviewByteSession";

function preview(payload: Uint8Array): PyContentPreview {
  return {
    preview_id: "preview-1",
    item_id: "item-1",
    revision: "a".repeat(64),
    revision_sha256: "a".repeat(64),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    metadata: {},
    files: [
      {
        file_ref: "file-1",
        role: "primary",
        ordinal: 1,
        filename: "preview.json",
        media_type: "application/json",
        size_bytes: payload.byteLength,
        sha256: createHash("sha256").update(payload).digest("hex"),
        url: "/v1/content/previews/preview-1/revisions/rev/files/file-1",
      },
    ],
  };
}

describe("PreviewByteSession", () => {
  it("verifies exact bytes and revokes its ephemeral object URLs", async () => {
    const payload = new TextEncoder().encode('{"ok":true}');
    const revoke = vi.fn();
    const session = await PreviewByteSession.prepare(preview(payload), {
      fetcher: vi.fn(async () => new Response(payload)),
      createObjectURL: () => "blob:preview-1",
      revokeObjectURL: revoke,
    });

    expect(session.files.get("file-1")?.objectUrl).toBe("blob:preview-1");
    session.dispose();
    session.dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it("rejects changed bytes without retaining object URLs", async () => {
    const expected = new TextEncoder().encode("expected");
    const changed = new TextEncoder().encode("changed!");
    await expect(
      PreviewByteSession.prepare(preview(expected), {
        fetcher: vi.fn(async () => new Response(changed)),
        createObjectURL: () => "blob:should-not-exist",
      }),
    ).rejects.toThrow("digest changed");
  });
});
