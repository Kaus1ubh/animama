import { describe, expect, it } from "vitest";

import {
  createDefaultVFXTransform,
  parseAvatarVFXCatalogEntry,
} from "./catalog";

const base = {
  id: "test",
  label: "Test",
  description: "Test effect",
  assetPath: "test.png",
  region: "eyes",
  transform: createDefaultVFXTransform(),
};
const eye = { ...base, kind: "hover", hoverKind: "eye_hover" };
const mouth = { ...base, kind: "hover", hoverKind: "mouth_hover" };
const decal = { ...base, kind: "face_anchored", anchor: "mouth" };

describe("Avatar VFX facial controls", () => {
  it.each([true, false])("preserves explicit eye settings %s", (value) => {
    expect(
      parseAvatarVFXCatalogEntry({
        ...eye,
        forceBlink: value,
        autoDisableEyeMaterials: value,
        faceCleanup: value,
        disableTargetRoles: ["eye_highlight"],
      }),
    ).toMatchObject({
      forceBlink: value,
      autoDisableEyeMaterials: value,
      faceCleanup: value,
      disableTargetRoles: ["eye_highlight"],
    });
  });

  it.each([mouth, decal])("preserves mouth cleanup settings", (effect) => {
    expect(
      parseAvatarVFXCatalogEntry({ ...effect, faceCleanup: false }),
    ).toHaveProperty("faceCleanup", false);
  });

  it.each(["forceBlink", "autoDisableEyeMaterials", "faceCleanup"])(
    "rejects malformed %s",
    (field) => {
      for (const value of ["false", 0, null, {}]) {
        expect(() =>
          parseAvatarVFXCatalogEntry({ ...eye, [field]: value }),
        ).toThrow(`${field}" must be a boolean`);
      }
    },
  );

  it.each([mouth, decal])("rejects malformed mouth cleanup", (effect) => {
    expect(() =>
      parseAvatarVFXCatalogEntry({ ...effect, faceCleanup: "true" }),
    ).toThrow('faceCleanup" must be a boolean');
  });

  it("does not apply eye controls to other subtypes", () => {
    const parsed = parseAvatarVFXCatalogEntry({
      ...base,
      kind: "hover",
      hoverKind: "box_hover",
      placement: "top-middle",
      forceBlink: true,
      autoDisableEyeMaterials: true,
      faceCleanup: true,
    });
    expect(parsed).not.toHaveProperty("forceBlink");
    expect(parsed).not.toHaveProperty("autoDisableEyeMaterials");
    expect(parsed).not.toHaveProperty("faceCleanup");
  });
});
