import { describe, expect, it } from "vitest";

import {
  gatewayUploadHeaders,
  contentFileFingerprint,
  getContentUploadErrorPresentation,
} from "./contentUploads";

describe("contentFileFingerprint", () => {
  it("does not depend on the browser-generated File timestamp", () => {
    const first = new File(["same bytes"], "reaction.json", {
      type: "application/json",
      lastModified: 1,
    });
    const retry = new File(["same bytes"], "reaction.json", {
      type: "application/json",
      lastModified: 2,
    });

    expect(contentFileFingerprint(first, "a".repeat(64))).toBe(
      contentFileFingerprint(retry, "a".repeat(64)),
    );
  });
});

describe("gatewayUploadHeaders", () => {
  it("preserves digest metadata without sending browser identity", () => {
    const headers = gatewayUploadHeaders({
      Authorization: "Bearer obsolete",
      Digest: "sha-256=:abc:=",
      "Content-Type": "application/octet-stream",
    });

    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Digest")).toBe("sha-256=:abc:=");
    expect(headers.get("Content-Type")).toBe("application/octet-stream");
  });
});

describe("getContentUploadErrorPresentation", () => {
  it.each([
    {
      envelope: {
        detail: { code: "content_upload_retry_required" },
      },
      label: "direct FastAPI",
    },
    {
      envelope: {
        data: { detail: { code: "content_upload_retry_required" } },
      },
      label: "legacy wrapped",
    },
  ])("maps a $label envelope through the shared parser", ({ envelope }) => {
    expect(getContentUploadErrorPresentation(envelope)).toEqual({
      message: "Retry this file to create a fresh private staging upload.",
      code: "content_upload_retry_required",
      details: {},
    });
  });
});
