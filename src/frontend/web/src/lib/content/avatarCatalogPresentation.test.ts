import { describe, expect, it } from "vitest";

import { avatarCatalogPresentation } from "./avatarCatalogPresentation";

const base = {
  id: "avatar-1",
  name: "Annie",
  file_path: "/annie.vrm",
  identity: "",
  model_type: "vrm",
  private: false,
  presentation_revision: 1,
  source: { type: "builtin" as const, avatar_id: "avatar-1", version: 1 },
};

describe("avatarCatalogPresentation", () => {
  it("keeps built-in versions exact", () => {
    expect(avatarCatalogPresentation(base).exactSource).toEqual({
      type: "builtin",
      avatar_id: "avatar-1",
      version: 1,
    });
  });

  it("projects a private catalog Avatar directly", () => {
    expect(
      avatarCatalogPresentation({
        ...base,
        catalog_item_id: "content-avatar",
        source: {
          type: "catalog",
          avatar_id: "avatar-1",
          catalog_item_id: "content-avatar",
        },
        private: true,
        presentation_revision: 4,
      }),
    ).toMatchObject({
      origin: "owned",
      ready: true,
      presentationRevision: 4,
      exactSource: {
        type: "catalog",
        avatar_id: "avatar-1",
        catalog_item_id: "content-avatar",
      },
    });
  });
});
