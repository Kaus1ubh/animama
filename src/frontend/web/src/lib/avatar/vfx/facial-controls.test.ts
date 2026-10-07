import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Avatar } from "../Avatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { AvatarVFXController } from "./AvatarVFXController";
import { loadEffectImage } from "./effect-image";
import type { AvatarFaceLandmarksSnapshot } from "./landmark-types";
import type {
  AvatarFaceTextureAnchorsSnapshot,
  AvatarFaceTextureAnchorSnapshot,
} from "./texture-anchor-types";
import type { AvatarFacePartMap, AvatarFacePartRole } from "./faceParts";
import type { AvatarEyeHoverVFXEntry, AvatarVFXCatalogEntry } from "./types";

vi.mock("../vrmEditorInspection", () => ({
  buildRuntimePrimitiveBindings: vi.fn(),
}));
vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/** Minimal canvas boundary for sampling and compositing; no WebGL renderer needed. */
class TestCanvas {
  width = 200;
  height = 100;
  getContext() {
    return {
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => ({
        data: new Uint8ClampedArray([220, 190, 160, 255]),
      }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
    };
  }
}

const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
const bounds = {
  min: vec(-0.1, -0.12, -0.05),
  max: vec(0.1, 0.12, 0.05),
  size: vec(0.2, 0.24, 0.1),
  center: vec(),
};
const textureAnchor = (
  side: "left" | "right" | null,
  u: number,
): AvatarFaceTextureAnchorSnapshot => ({
  anchor: "blush",
  side,
  source: "geometric",
  localPoint: vec(side === "left" ? 0.04 : -0.04, -0.02, 0.05),
  worldPoint: null,
  uv: { u, v: 0.5 },
  referenceSizeLocal: { width: 0.02, height: 0.01 },
  referenceSizeUv: { width: 0.1, height: 0.1 },
});
const transform = () => ({
  offset: vec(),
  scale: vec(1, 1, 1),
  rotation: vec(),
});
const base = () => ({
  id: "preview",
  label: "Test",
  description: "",
  assetPath: "blob:test",
  region: "eyes" as const,
  transform: transform(),
});
const eyeEffect = (): AvatarEyeHoverVFXEntry => ({
  ...base(),
  kind: "hover",
  hoverKind: "eye_hover",
  side: "left",
  requiresMirror: false,
});
describe("authored facial behavior", () => {
  let controller: AvatarVFXController;
  let anchor: THREE.Group;
  let landmarks: AvatarFaceLandmarksSnapshot;
  let anchors: AvatarFaceTextureAnchorsSnapshot;
  let image: TestCanvas;
  let originalTexture: TestCanvas;
  let avatar: Avatar;
  let meshes: Record<string, THREE.Mesh>;
  let originalFaceMaterial: THREE.Material | THREE.Material[];
  const controllers: AvatarVFXController[] = [];

  beforeEach(() => {
    vi.stubGlobal("HTMLCanvasElement", TestCanvas);
    vi.stubGlobal("document", { createElement: () => new TestCanvas() });
    anchor = new THREE.Group();
    image = new TestCanvas();
    originalTexture = new TestCanvas();
    vi.mocked(loadEffectImage).mockResolvedValue(
      image as unknown as HTMLCanvasElement,
    );
    landmarks = {
      status: "ready",
      warnings: [],
      anchorName: "head",
      anchorType: "bone",
      faceBindingKey: "face",
      faceMaterialName: "Face Skin",
      faceBoundsLocal: bounds,
      frontZLocal: 0.05,
      boxHoverClearanceLocal: 0.01,
      boxHoverFrontZLocal: 0.06,
      eyes: { left: null, right: null },
    };
    for (const side of ["left", "right"] as const) {
      const point = vec(side === "left" ? 0.04 : -0.04, 0.02, 0.02);
      landmarks.eyes[side] = {
        bindingKey: "iris",
        materialName: "Iris",
        vertexCount: 4,
        boundsLocal: bounds,
        centerLocal: point,
        centerWorld: null,
        projectedFrontLocal: { ...point, z: 0.05 },
        projectedFrontWorld: null,
        normalizedBoxCoord: { u: 0.5, v: 0.5, w: 0.5 },
        projectedBoxCoord: { u: 0.5, v: 0.5, w: 1 },
      };
    }
    anchors = {
      status: "ready",
      warnings: [],
      faceBindingKey: "face",
      faceMaterialName: "Face Skin",
      anchors: {
        undereye: {
          left: textureAnchor("left", 0.25),
          right: textureAnchor("right", 0.75),
        },
        blush: {
          left: textureAnchor("left", 0.25),
          right: textureAnchor("right", 0.75),
        },
        mouth: {
          center: {
            ...textureAnchor(null, 0.5),
            anchor: "mouth",
            source: "fallback",
          },
        },
      },
      flatten: {
        sample: { center: null },
        eyes: { left: null, right: null },
        mouth: { center: null },
      },
    };
    meshes = {};
    const flattenRegion = {
      side: null,
      source: "geometric" as const,
      localPoint: vec(),
      worldPoint: null,
      uv: { u: 0.5, v: 0.5 },
      referenceSizeLocal: { width: 0.02, height: 0.01 },
      referenceSizeUv: { width: 0.1, height: 0.1 },
    };
    anchors.flatten.sample.center = { ...flattenRegion, region: "sample" };
    anchors.flatten.eyes.left = {
      ...flattenRegion,
      region: "eye",
      side: "left",
    };
    anchors.flatten.mouth.center = { ...flattenRegion, region: "mouth" };
    const entries = [
      "face",
      "untextured_iris",
      "iris",
      "eye_highlight",
      "eyeline",
      "eyelash",
    ].map((key) => {
      const material = new THREE.MeshBasicMaterial({
        map: ["face", "iris"].includes(key)
          ? new THREE.Texture(originalTexture as unknown as HTMLCanvasElement)
          : null,
      });
      material.name = key === "face" ? "Face Skin" : key;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
      meshes[key] = mesh;
      return {
        bindingKey: key,
        materialName: material.name,
        object: mesh,
        materialIndex: 0,
        nodeIndex: 0,
        meshIndex: 0,
        primitiveIndex: 0,
        visible: true,
        isSkinnedMesh: false,
        objectName: key,
        objectType: "Mesh",
        originalVisible: true,
      };
    });
    vi.mocked(buildRuntimePrimitiveBindings).mockReturnValue({
      entries,
      warnings: [],
    } as ReturnType<typeof buildRuntimePrimitiveBindings>);
    originalFaceMaterial = meshes.face.material;
    avatar = {
      sourceUrl: null,
      sourceKey: null,
      faceLandmarks: { getAnchorObject: () => anchor },
      getFaceLandmarksSnapshot: () => landmarks,
      getFaceTextureAnchorsSnapshot: () => anchors,
      setExpression: vi.fn(),
      clearExpressionOverride: vi.fn(),
    } as unknown as Avatar;
    controller = new AvatarVFXController(avatar);
    controllers.push(controller);
  });
  afterEach(() => {
    controllers.splice(0).forEach((c) => c.dispose());
    vi.unstubAllGlobals();
  });

  const apply = async (effect: AvatarVFXCatalogEntry) =>
    controller.applyEffect({
      bindingKey:
        effect.kind === "hover" && effect.hoverKind === "eye_hover"
          ? "iris"
          : "face",
      effectId: effect.id,
      effectEntry: effect,
    });

  it("preserves legacy eye defaults and restores original state on removal", async () => {
    await apply(eyeEffect());
    expect(avatar.setExpression).toHaveBeenCalledWith("blink", 1);
    expect(meshes.eye_highlight.visible).toBe(false);
    expect(meshes.eyeline.visible).toBe(false);
    expect(meshes.eyelash.visible).toBe(false);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(true);
    expect(meshes.face.material).not.toBe(originalFaceMaterial);
    controller.removeEffect("preview");
    expect(avatar.clearExpressionOverride).toHaveBeenCalledWith("blink");
    expect(meshes.eye_highlight.visible).toBe(true);
    expect(meshes.eyeline.visible).toBe(true);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(false);
    expect(meshes.face.material).toBe(originalFaceMaterial);
  });

  it("disables each automatic eye behavior while honoring explicit suppression", async () => {
    await apply({
      ...eyeEffect(),
      forceBlink: false,
      autoDisableEyeMaterials: false,
      faceCleanup: false,
      disableTargetRoles: ["eye_highlight"],
    });
    expect(avatar.setExpression).not.toHaveBeenCalled();
    expect(meshes.eye_highlight.visible).toBe(false);
    expect(meshes.eyeline.visible).toBe(true);
    expect(meshes.eyelash.visible).toBe(true);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(false);
    expect(meshes.face.material).toBe(originalFaceMaterial);
  });

  it("keeps automatic cleanup independent of blink and suppression", async () => {
    await apply({
      ...eyeEffect(),
      forceBlink: false,
      autoDisableEyeMaterials: false,
    });
    expect(avatar.setExpression).not.toHaveBeenCalled();
    expect(meshes.eyeline.visible).toBe(true);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(true);
    expect(meshes.face.material).not.toBe(originalFaceMaterial);
    controller.removeEffect("preview");
    await apply({
      ...eyeEffect(),
      faceCleanup: false,
      disableTargetRoles: ["face_skin"],
    });
    expect(avatar.setExpression).toHaveBeenCalledWith("blink", 1);
    expect(meshes.eyeline.visible).toBe(false);
    expect(meshes.face.visible).toBe(false);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(false);
    controller.clearAllEffects();
    expect(meshes.face.visible).toBe(true);
  });

  it("texture suppression is explicit and preserves prior visibility", async () => {
    meshes.eye_highlight.visible = false;
    await controller.applyTextureVFX({
      effectId: "texture",
      effectEntry: {
        ...base(),
        id: "texture",
        kind: "texture",
        targetRole: "eye_iris",
        applyMode: "overlay",
        assetShape: "single_eye",
        side: "left",
        disableTargetRoles: ["eye_highlight", "eyelash"],
      },
    });
    expect(controller.getSnapshot().activeEffects).toHaveLength(1);
    expect(meshes.eyeline.visible).toBe(true);
    expect(meshes.eyelash.visible).toBe(false);
    expect(avatar.setExpression).not.toHaveBeenCalled();
    controller.clearAllEffects();
    expect(meshes.eye_highlight.visible).toBe(false);
    expect(meshes.eyelash.visible).toBe(true);
  });

  it("skips an untextured iris when automatically selecting a texture replacement target", async () => {
    const untexturedMaterial = meshes.untextured_iris.material;
    const texturedMaterial = meshes.iris.material;
    expect(
      controller
        .getSnapshot()
        .targetBindings.map((binding) => binding.bindingKey),
    ).toContain("untextured_iris");
    await controller.applyTextureVFX({
      effectId: "replacement",
      effectEntry: {
        ...base(),
        id: "replacement",
        kind: "texture",
        targetRole: "eye_iris",
        applyMode: "replace",
        assetShape: "single_eye",
        side: "left",
      },
    });
    expect(controller.getSnapshot().activeEffects).toEqual([
      expect.objectContaining({
        appliedEffectId: "replacement",
        bindingKey: "iris",
      }),
    ]);
    expect(meshes.untextured_iris.material).toBe(untexturedMaterial);
    expect(meshes.iris.material).not.toBe(texturedMaterial);
  });

  it("keeps shared behaviors until the final requesting effect is removed", async () => {
    await apply({ ...eyeEffect(), id: "first", region: "emote" });
    await apply({ ...eyeEffect(), id: "second", region: "emote" });
    await apply({
      ...eyeEffect(),
      id: "passive",
      region: "emote",
      forceBlink: false,
      autoDisableEyeMaterials: false,
      faceCleanup: false,
    });
    controller.removeEffect("first");
    expect(meshes.eye_highlight.visible).toBe(false);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(true);
    expect(avatar.clearExpressionOverride).not.toHaveBeenCalled();
    controller.removeEffect("second");
    expect(meshes.eye_highlight.visible).toBe(true);
    expect(controller.getSnapshot().flatten.autoEyes).toBe(false);
    expect(avatar.clearExpressionOverride).toHaveBeenCalledWith("blink");
    expect(meshes.face.material).toBe(originalFaceMaterial);
  });

  it("fades the face changes with the event envelope", async () => {
    const findBackdrop = () => {
      let found: THREE.Mesh | null = null;
      anchor.traverse((object) => {
        if (object instanceof THREE.Mesh && object.name.endsWith(":backdrop")) {
          found = object;
        }
      });
      return found as THREE.Mesh | null;
    };
    const backdropOpacity = () =>
      (findBackdrop()?.material as THREE.Material | undefined)?.opacity;
    const hidden = () => ({
      highlight: !meshes.eye_highlight.visible,
      eyeline: !meshes.eyeline.visible,
      cleanup: controller.getSnapshot().flatten.autoEyes,
      faceComposited: meshes.face.material !== originalFaceMaterial,
    });
    const allOff = {
      highlight: false,
      eyeline: false,
      cleanup: false,
      faceComposited: false,
    };
    const allOn = {
      highlight: true,
      eyeline: true,
      cleanup: true,
      faceComposited: true,
    };

    // The first faint frame closes the eyes a little and hides nothing.
    controller.setEffectIntensity("preview", 0.2);
    await apply({ ...eyeEffect(), skinBackdrop: true });
    expect(avatar.setExpression).toHaveBeenLastCalledWith("blink", 0.2);
    expect(hidden()).toEqual(allOff);
    expect(backdropOpacity()).toBeCloseTo(0.2);

    // Hidden parts and face cleanup switch on at the midpoint.
    controller.setEffectIntensity("preview", 0.5);
    expect(avatar.setExpression).toHaveBeenLastCalledWith("blink", 0.5);
    expect(hidden()).toEqual(allOn);
    expect(backdropOpacity()).toBeCloseTo(0.5);

    controller.setEffectIntensity("preview", 0.8);
    expect(avatar.setExpression).toHaveBeenLastCalledWith("blink", 0.8);
    expect(hidden()).toEqual(allOn);

    // A fade-out restores them below the midpoint and releases the blink at 0.
    controller.setEffectIntensity("preview", 0.3);
    expect(avatar.setExpression).toHaveBeenLastCalledWith("blink", 0.3);
    expect(hidden()).toEqual(allOff);
    expect(backdropOpacity()).toBeCloseTo(0.3);
    controller.setEffectIntensity("preview", 0);
    expect(avatar.clearExpressionOverride).toHaveBeenLastCalledWith("blink");
    expect(hidden()).toEqual(allOff);

    controller.setEffectIntensity("preview", 1);
    expect(avatar.setExpression).toHaveBeenLastCalledWith("blink", 1);
    expect(hidden()).toEqual(allOn);
    expect(backdropOpacity()).toBeCloseTo(1);
    controller.removeEffect("preview");
    expect(hidden()).toEqual(allOff);
  });

  it("switches hidden texture parts and mouth cleanup at the midpoint", async () => {
    await controller.applyTextureVFX({
      effectId: "texture",
      effectEntry: {
        ...base(),
        id: "texture",
        kind: "texture",
        targetRole: "eye_iris",
        applyMode: "overlay",
        assetShape: "single_eye",
        side: "left",
        disableTargetRoles: ["eyelash"],
      },
    });
    controller.setEffectIntensity("texture", 0.49);
    expect(meshes.eyelash.visible).toBe(true);
    controller.setEffectIntensity("texture", 0.5);
    expect(meshes.eyelash.visible).toBe(false);
    controller.clearAllEffects();
    expect(meshes.eyelash.visible).toBe(true);

    const mouth = {
      ...base(),
      kind: "face_anchored" as const,
      anchor: "mouth" as const,
    };
    controller.setEffectIntensity(mouth.id, 0.1);
    await apply(mouth);
    expect(controller.getSnapshot().flatten.autoMouth).toBe(false);
    controller.setEffectIntensity(mouth.id, 0.7);
    expect(controller.getSnapshot().flatten.autoMouth).toBe(true);
    controller.setEffectIntensity(mouth.id, 0.2);
    expect(controller.getSnapshot().flatten.autoMouth).toBe(false);
  });

  it("paints a corrected part on a mesh that also holds a detected part", async () => {
    // Annie's lashes are drawn in her eye-line mesh: the user corrects
    // Eyelashes to that mesh while detection keeps it as the eye line.
    (meshes.eyeline.material as THREE.MeshBasicMaterial).map =
      new THREE.Texture(originalTexture as unknown as HTMLCanvasElement);
    const part = (role: AvatarFacePartRole, bindings: string[]) => ({
      role,
      bindings,
      source: bindings.length ? ("signals" as const) : ("missing" as const),
      confidence: bindings.length ? 0.9 : 0,
    });
    const map: AvatarFacePartMap = {
      parts: {
        face_skin: part("face_skin", ["face"]),
        eye_left: part("eye_left", ["iris"]),
        eye_right: part("eye_right", ["iris"]),
        eye_highlight: part("eye_highlight", ["eye_highlight"]),
        eyeline: part("eyeline", ["eyeline"]),
        eyelash: {
          role: "eyelash",
          bindings: ["eyeline"],
          source: "corrected",
          confidence: 1,
          detected: part("eyelash", []),
        },
        hair: part("hair", []),
      },
      eyeWhite: [],
      diagnostics: [],
    };
    const partController = new AvatarVFXController({
      ...avatar,
      facePartMap: map,
    } as Avatar);
    controllers.push(partController);
    const originalLineMaterial = meshes.eyeline.material;
    const paint = (role: "eyelash" | "eyeline") => ({
      ...base(),
      id: `paint-${role}`,
      region: "eyes" as const,
      kind: "texture" as const,
      targetRole: role,
      applyMode: "overlay" as const,
      assetShape: "full_face" as const,
    });

    // The corrected role is the mesh's primary role.
    expect(
      partController
        .getSnapshot()
        .targetBindings.find((binding) => binding.bindingKey === "eyeline")
        ?.targetRole,
    ).toBe("eyelash");
    expect(
      partController.getPlacementGuides(paint("eyelash"), "x").messages,
    ).not.toContain(
      "No compatible material target is available on this avatar.",
    );

    await partController.applyTextureVFX({
      effectId: "paint-eyelash",
      effectEntry: paint("eyelash"),
    });
    expect(partController.getSnapshot().activeEffects).toEqual([
      expect.objectContaining({
        appliedEffectId: "paint-eyelash",
        bindingKey: "eyeline",
      }),
    ]);
    expect(meshes.eyeline.material).not.toBe(originalLineMaterial);
    expect(partController.getSnapshot().warnings).toEqual([]);

    // An effect on the detected eye line still finds the same mesh.
    partController.clearAllEffects();
    await partController.applyTextureVFX({
      effectId: "paint-eyeline",
      effectEntry: paint("eyeline"),
    });
    expect(partController.getSnapshot().activeEffects).toEqual([
      expect.objectContaining({ bindingKey: "eyeline" }),
    ]);

    // Hiding eye details hides the shared mesh once, and restores it.
    partController.clearAllEffects();
    await partController.applyHoverVFX({
      effectId: "preview",
      effectEntry: eyeEffect(),
    });
    expect(meshes.eyeline.visible).toBe(false);
    expect(meshes.face.visible).toBe(true);
    partController.clearAllEffects();
    expect(meshes.eyeline.visible).toBe(true);
    expect(meshes.eyeline.material).toBe(originalLineMaterial);
  });

  it("never hides face skin that a correction also named an eye detail", async () => {
    const part = (role: AvatarFacePartRole, bindings: string[]) => ({
      role,
      bindings,
      source: "signals" as const,
      confidence: 0.9,
    });
    const partController = new AvatarVFXController({
      ...avatar,
      facePartMap: {
        parts: {
          face_skin: part("face_skin", ["face"]),
          eye_left: part("eye_left", ["iris"]),
          eye_right: part("eye_right", ["iris"]),
          eye_highlight: part("eye_highlight", ["eye_highlight"]),
          eyeline: part("eyeline", ["eyeline"]),
          eyelash: {
            ...part("eyelash", ["face"]),
            source: "corrected",
            detected: part("eyelash", []),
          },
          hair: part("hair", []),
        },
        eyeWhite: [],
        diagnostics: [],
      },
    } as unknown as Avatar);
    controllers.push(partController);
    await partController.applyHoverVFX({
      effectId: "preview",
      effectEntry: eyeEffect(),
    });
    expect(meshes.eyeline.visible).toBe(false);
    expect(meshes.face.visible).toBe(true);
  });

  it.each(["hover", "face_anchored"] as const)(
    "controls %s mouth cleanup independently of placement",
    async (kind) => {
      const mouth =
        kind === "hover"
          ? {
              ...base(),
              kind,
              hoverKind: "mouth_hover" as const,
              skinBackdrop: false,
            }
          : { ...base(), kind, anchor: "mouth" as const };
      await apply(mouth);
      expect(controller.getSnapshot().flatten.autoMouth).toBe(true);
      controller.removeEffect(mouth.id);
      expect(controller.getSnapshot().flatten.autoMouth).toBe(false);
      expect(meshes.face.material).toBe(originalFaceMaterial);
      await apply({ ...mouth, faceCleanup: false });
      expect(controller.getSnapshot().flatten.autoMouth).toBe(false);
      expect(controller.getSnapshot().activeEffects).toHaveLength(1);
      controller.clearAllEffects();
      expect(meshes.face.material).toBe(originalFaceMaterial);
    },
  );
});
