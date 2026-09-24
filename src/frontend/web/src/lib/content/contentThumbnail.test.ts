import type { PyTypedContentFile } from "@animama/runtime-contracts/api-types";
import { describe, expect, it } from "vitest";
import { contentThumbnailUrl } from "./contentThumbnail";

function file(
  ordinal: number,
  media_type: string,
  file_ref: string,
): PyTypedContentFile {
  return {
    ordinal,
    media_type,
    file_ref,
    role: "image",
    filename: "asset",
    logical_path: "asset",
    size_bytes: 1,
    sha256: "a".repeat(64),
  };
}

describe("content thumbnails", () => {
  it("selects the first image in registered order without changing the input", () => {
    const files = [
      file(3, "image/png", "later"),
      file(1, "application/json", "manifest"),
      file(2, "image/svg+xml", "first / image"),
    ];
    expect(contentThumbnailUrl(files)).toBe(
      "/v1/content/files/first%20%2F%20image",
    );
    expect(files.map((item) => item.ordinal)).toEqual([3, 1, 2]);
  });

  it("leaves procedural effects and unsupported resources without a thumbnail", () => {
    expect(contentThumbnailUrl([])).toBeNull();
    expect(
      contentThumbnailUrl([
        file(1, "application/json", "manifest"),
        file(2, "text/html", "page"),
      ]),
    ).toBeNull();
  });
});
