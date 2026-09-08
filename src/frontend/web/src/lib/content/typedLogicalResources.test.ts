import { describe, expect, it } from "vitest";

import type { PyTypedContentPreview } from "@animama/runtime-contracts/api-types";
import {
  findLogicalResourceFile,
  typedLogicalResourceFiles,
} from "./typedLogicalResources";

describe("typed logical resources", () => {
  it("preserves nested item-relative paths and opaque file identities", () => {
    const item = {
      files: [
        {
          file_ref: "manifest-ref",
          logical_path: "particle.json",
          role: "manifest",
          ordinal: 2,
        },
        {
          file_ref: "texture-ref",
          logical_path: "textures/heart.png",
          role: "texture",
          ordinal: 3,
        },
      ],
    } as PyTypedContentPreview["item"];

    expect(typedLogicalResourceFiles(item)).toEqual({
      "textures/heart.png": {
        file_ref: "texture-ref",
        role: "texture",
        ordinal: 3,
      },
    });
  });

  it("matches by file ref when closure-wide ordinals differ", () => {
    const files = [
      { file_ref: "other-ref", role: "texture", ordinal: 3 },
      { file_ref: "texture-ref", role: "texture", ordinal: 8 },
    ];

    expect(
      findLogicalResourceFile(files, {
        file_ref: "texture-ref",
        role: "texture",
        ordinal: 3,
      }),
    ).toEqual(files[1]);
  });
});
