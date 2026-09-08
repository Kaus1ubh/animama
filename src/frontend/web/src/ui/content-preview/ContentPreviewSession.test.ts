import { describe, expect, it } from "vitest";

import { ContentPreviewSession } from "./ContentPreviewSession";

describe("ContentPreviewSession", () => {
  it("ignores stale preparation results", () => {
    const session = new ContentPreviewSession();
    const stale = session.begin();
    const current = session.begin();
    const preview = {
      preview_id: "preview-1",
      revision: "revision-1",
      revision_sha256: "revision-1",
      expires_at: "2026-08-10T00:00:00Z",
      files: [],
      metadata: {},
    };
    expect(session.commit(stale, preview)).toBe(false);
    expect(session.commit(current, preview)).toBe(true);
    expect(session.preview).toEqual(preview);
  });
});
