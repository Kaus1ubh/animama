import { describe, expect, it } from "vitest";

import type { PyContentPreview } from "@/lib/content/catalogTypes";
import { avatarPreviewTarget } from "./avatarPreviewTarget";

describe("avatarPreviewTarget", () => {
  it("maps a private Avatar VRM to an authorized model file", () => {
    const preview: PyContentPreview = {
      preview_id: "avatar-private",
      revision: "avatar-revision",
      revision_sha256: "avatar-revision",
      expires_at: "2026-08-13T00:05:00Z",
      files: [
        {
          file_ref: "vrm-ref",
          role: "vrm",
          ordinal: 1,
          filename: "avatar.vrm",
          media_type: "model/gltf-binary",
          size_bytes: 10,
          sha256: "a".repeat(64),
          url: "/v1/content/previews/avatar-private/vrm-ref",
        },
      ],
      metadata: { content_type: "avatar", spec: { presentation: {} } },
    };

    const target = avatarPreviewTarget(preview, "My Avatar");
    expect(target.kind).toBe("avatar_model");
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    expect(target.entry.source).toMatchObject({
      type: "authorized_files",
      files: [{ role: "model", url: expect.stringContaining("vrm-ref") }],
    });
  });

  it("maps an Included Avatar to its registered catalog file", () => {
    const preview: PyContentPreview = {
      preview_id: "builtin:avatar:annie:1",
      revision: "builtin-1",
      revision_sha256: "builtin-1",
      expires_at: "2026-08-13T00:05:00Z",
      files: [
        {
          file_ref: "annie-vrm-ref",
          role: "vrm",
          ordinal: 1,
          filename: "annie.vrm",
          media_type: "model/gltf-binary",
          size_bytes: 10,
          sha256: "b".repeat(64),
          url: "/v1/content/previews/builtin-avatar/annie-vrm-ref",
        },
      ],
      metadata: { content_type: "avatar", spec: { presentation: {} } },
    };
    const target = avatarPreviewTarget(preview, "Annie");
    if (target.sourceType !== "resolved_entry") throw new Error("fixture");
    expect(target.entry.source).toMatchObject({
      type: "authorized_files",
      files: [{ role: "model", filename: "annie.vrm" }],
    });
  });
});
