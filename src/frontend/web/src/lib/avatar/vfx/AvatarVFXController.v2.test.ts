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
import type {
  AvatarFaceAnchoredSingleDecalVFXEntry,
  AvatarHoverVFXEntry,
  AvatarVFXCatalogEntry,
} from "./types";

vi.mock("../vrmEditorInspection", () => ({
  buildRuntimePrimitiveBindings: vi.fn(),
}));
vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

type Draw = {
  image: unknown;
  points: THREE.Vector3[];
  alpha: number;
  operation: string;
  source: number[] | null;
};

/** Record drawing transforms, alpha and composite operation for each draw. */
class TestCanvas {
  width = 200;
  height = 100;
  draws: Draw[] = [];
  fills: string[] = [];
  getContext() {
    let matrix = new THREE.Matrix4();
    const stack: {
      matrix: THREE.Matrix4;
      alpha: number;
      operation: string;
    }[] = [];
    const state = {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      fillStyle: "",
    };
    return Object.assign(state, {
      save: () =>
        stack.push({
          matrix: matrix.clone(),
          alpha: state.globalAlpha,
          operation: state.globalCompositeOperation,
        }),
      restore: () => {
        const previous = stack.pop()!;
        matrix = previous.matrix;
        state.globalAlpha = previous.alpha;
        state.globalCompositeOperation = previous.operation;
      },
      fillRect: () => this.fills.push(state.fillStyle),
      translate: (x: number, y: number) =>
        matrix.multiply(new THREE.Matrix4().makeTranslation(x, y, 0)),
      rotate: (z: number) =>
        matrix.multiply(new THREE.Matrix4().makeRotationZ(z)),
      scale: (x: number, y: number) =>
        matrix.multiply(new THREE.Matrix4().makeScale(x, y, 1)),
      clearRect: () => {},
      getImageData: () => ({
        data: new Uint8ClampedArray([220, 190, 160, 255]),
      }),
      createRadialGradient: () => ({ addColorStop: () => {} }),
      beginPath: () => {},
      arc: () => {},
      fill: () => {},
      drawImage: (image: unknown, ...args: number[]) => {
        const [x, y, w, h] = args.length === 8 ? args.slice(4) : args;
        this.draws.push({
          image,
          alpha: state.globalAlpha,
          operation: state.globalCompositeOperation,
          source: args.length === 8 ? args.slice(0, 4) : null,
          points: [
            [x!, y!],
            [x! + w!, y!],
            [x! + w!, y! + h!],
            [x!, y! + h!],
          ].map(([px, py]) =>
            new THREE.Vector3(px, py, 0).applyMatrix4(matrix),
          ),
        });
      },
    });
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
const eyeEffect = (): AvatarHoverVFXEntry => ({
  ...base(),
  kind: "hover",
  hoverKind: "eye_hover",
  side: "left",
  requiresMirror: false,
});
const decalEffect = (): AvatarFaceAnchoredSingleDecalVFXEntry => ({
  ...base(),
  region: "blush",
  kind: "face_anchored",
  anchor: "blush",
  layout: "single",
  side: "left",
  requiresMirror: false,
  pivot: "center",
});

const created: TestCanvas[] = [];
const allDraws = () => created.flatMap((canvas) => canvas.draws);

describe("Avatar Effect v2 runtime features", () => {
  let controller: AvatarVFXController;
  let anchor: THREE.Group;
  let landmarks: AvatarFaceLandmarksSnapshot;
  let anchors: AvatarFaceTextureAnchorsSnapshot;
  let image: TestCanvas;
  let otherImage: TestCanvas;
  let originalTexture: TestCanvas;
  const controllers: AvatarVFXController[] = [];

  beforeEach(() => {
    vi.stubGlobal("HTMLCanvasElement", TestCanvas);
    created.length = 0;
    vi.stubGlobal("document", {
      createElement: () => {
        const canvas = new TestCanvas();
        created.push(canvas);
        return canvas;
      },
    });
    anchor = new THREE.Group();
    image = new TestCanvas();
    otherImage = new TestCanvas();
    originalTexture = new TestCanvas();
    vi.mocked(loadEffectImage).mockImplementation(
      async (path: string) =>
        (path === "blob:other"
          ? otherImage
          : image) as unknown as HTMLCanvasElement,
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
    const entries = ["face", "iris"].map((key) => {
      const material = new THREE.MeshBasicMaterial({
        map: new THREE.Texture(originalTexture as unknown as HTMLCanvasElement),
      });
      material.name = key === "face" ? "Face Skin" : "Iris";
      return {
        bindingKey: key,
        materialName: material.name,
        object: new THREE.Mesh(new THREE.PlaneGeometry(), material),
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
    const avatar = {
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

  const lastDraw = (target: TestCanvas = image) =>
    compositeCanvas()
      .draws.filter((draw) => draw.image === target)
      .at(-1);
  const compositeCanvas = () => {
    const guide = controller.getPlacementGuides(decalEffect(), "preview");
    return guide.surfaces[0]!.image as unknown as TestCanvas;
  };
  const hoverMeshes = () => {
    const meshes: THREE.Mesh[] = [];
    anchor.traverse((object) => {
      if (object instanceof THREE.Mesh && !object.name.endsWith(":backdrop"))
        meshes.push(object);
    });
    return meshes;
  };

  it("draws composites with appearance opacity, blend and a cached tint", async () => {
    const effect = decalEffect();
    effect.appearance = { opacity: 0.5, tint: "#ff0000", blend: "multiply" };
    await apply(effect);
    const tintedCanvas = created.find((canvas) => canvas.fills.length > 0)!;
    // The tinted copy multiplies the tint, then restores the art's alpha.
    expect(tintedCanvas.fills).toEqual(["#ff0000"]);
    const draw = allDraws().find((value) => value.image === tintedCanvas);
    expect(draw).toMatchObject({ alpha: 0.5, operation: "multiply" });
    const tinted = draw!.image;
    controller.setEffectIntensity(effect.id, 0.5);
    controller.update(1 / 30);
    const after = compositeCanvas().draws.filter(
      (value) => value.image === tinted,
    );
    expect(after.at(-1)?.alpha).toBeCloseTo(0.25);
  });

  it.each([
    [1, false],
    [0.5, true],
  ])(
    "draws the original slot beneath a replacement at opacity %s: %s",
    async (opacity, baseDrawn) => {
      const effect: AvatarVFXCatalogEntry = {
        ...base(),
        region: "full_face",
        kind: "texture",
        targetRole: "face_skin",
        assetShape: "full_face",
        applyMode: "replace",
        appearance: { opacity, tint: null, blend: "normal" },
      };
      await apply(effect);
      expect(allDraws().some((draw) => draw.image === originalTexture)).toBe(
        baseDrawn,
      );
      expect(allDraws().some((draw) => draw.image === image)).toBe(true);
    },
  );

  it("applies appearance to hover planes", async () => {
    const effect = eyeEffect();
    effect.appearance = { opacity: 0.4, tint: "#00ff00", blend: "additive" };
    await apply(effect);
    const material = hoverMeshes()[0]!.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.4);
    expect(material.color.getHexString()).toBe("00ff00");
    expect(material.blending).toBe(THREE.AdditiveBlending);
  });

  it("draws the other-eye image unmirrored and mirrors offsets for the mirrored eye", async () => {
    const effect = {
      ...eyeEffect(),
      side: "right" as const,
      requiresMirror: true,
      otherEyeAssetPath: "blob:other",
    };
    effect.transform.offset.x = 0.01;
    await apply(effect);
    expect(loadEffectImage).toHaveBeenCalledWith("blob:other");
    const meshes = hoverMeshes();
    expect(meshes).toHaveLength(2);
    const mirrored = meshes.find((mesh) => mesh.name.endsWith(":left"))!;
    const primary = meshes.find((mesh) => mesh.name.endsWith(":right"))!;
    expect(mirrored.scale.x).toBeGreaterThan(0);
    expect(
      (mirrored.material as THREE.MeshBasicMaterial).map!.image as unknown,
    ).toBe(otherImage);
    expect(
      (primary.material as THREE.MeshBasicMaterial).map!.image as unknown,
    ).toBe(image);
    const roots = [mirrored, primary].map(
      (mesh) => mesh.parent!.parent!.parent!.position.x,
    );
    // Eyes sit at x = ±0.04; the offset moves each outward symmetrically.
    expect(roots[0]! + roots[1]!).toBeCloseTo(0);
  });

  describe("horizontal offsets on mirrored placements", () => {
    const irisTexture = (
      settings: Partial<AvatarVFXCatalogEntry>,
    ): AvatarVFXCatalogEntry =>
      ({
        ...base(),
        kind: "texture",
        targetRole: "eye_iris",
        assetShape: "single_eye",
        applyMode: "overlay",
        ...settings,
      }) as AvatarVFXCatalogEntry;
    /** Horizontal centres of the last two iris draws, left to right on the texture. */
    const irisCentres = () =>
      allDraws()
        .filter((draw) => draw.image === image)
        .slice(-2)
        .map((draw) => draw.points.reduce((sum, p) => sum + p.x, 0) / 4)
        .sort((a, b) => a - b);
    const shiftOf = async (
      settings: Partial<AvatarVFXCatalogEntry>,
      offset: (effect: AvatarVFXCatalogEntry) => void,
    ) => {
      const plain = irisTexture(settings);
      await controller.applyEffect({
        bindingKey: "iris",
        effectId: plain.id,
        effectEntry: plain,
      });
      const before = irisCentres();
      controller.removeEffect(plain.id);
      const shifted = irisTexture(settings);
      offset(shifted);
      await controller.applyEffect({
        bindingKey: "iris",
        effectId: shifted.id,
        effectEntry: shifted,
      });
      return irisCentres().map((value, index) => value - before[index]!);
    };
    const staticOffset = (effect: AvatarVFXCatalogEntry) => {
      effect.transform.offset.x = 0.05;
    };
    const keyframeOffset = (effect: AvatarVFXCatalogEntry) => {
      effect.keyframes = {
        loop: false,
        frames: [{ t: 0, offset: { x: 0.05, y: 0 } }],
      };
    };

    it.each([
      ["static", staticOffset],
      ["keyframe", keyframeOffset],
    ])(
      "mirrors the %s offset only on a texture's own mirrored copy",
      async (_kind, offset) => {
        const mirrored = await shiftOf(
          { side: "right", requiresMirror: true },
          offset,
        );
        expect(mirrored[0]).not.toBeCloseTo(0);
        expect(mirrored[0]! + mirrored[1]!).toBeCloseTo(0);
        // Without a side, the profile flips the right eye's UVs; that is not
        // the effect's mirror, so both eyes move the same way.
        const unmirrored = await shiftOf({}, offset);
        expect(unmirrored[0]).not.toBeCloseTo(0);
        expect(unmirrored[0]).toBeCloseTo(unmirrored[1]!);
      },
    );

    it.each([
      ["static", staticOffset],
      ["keyframe", keyframeOffset],
    ])(
      "mirrors the %s hover offset only on the mirrored eye",
      async (_kind, offset) => {
        /** World-free x of each placement, keyed by eye label. */
        const positionsOf = async (effect: AvatarVFXCatalogEntry) => {
          await apply(effect);
          const positions = Object.fromEntries(
            hoverMeshes().map((mesh) => {
              const animated = mesh.parent!.parent!;
              return [
                mesh.name.split(":").at(-1)!,
                animated.position.x + animated.parent!.position.x,
              ];
            }),
          );
          controller.removeEffect(effect.id);
          return positions;
        };
        const pair = () => ({
          ...eyeEffect(),
          side: "right" as const,
          requiresMirror: true,
        });
        const plain = await positionsOf(pair());
        const shiftedPair = pair();
        offset(shiftedPair);
        const shifted = await positionsOf(shiftedPair);
        expect(shifted.right! - plain.right!).toBeCloseTo(0.05);
        expect(shifted.left! - plain.left!).toBeCloseTo(-0.05);

        const singlePlain = await positionsOf(eyeEffect());
        const shiftedSingle = eyeEffect();
        offset(shiftedSingle);
        const singleShifted = await positionsOf(shiftedSingle);
        expect(singleShifted.left! - singlePlain.left!).toBeCloseTo(0.05);
      },
    );
  });

  it("plays hover flipbooks through texture repeat and offset", async () => {
    const effect = eyeEffect();
    effect.flipbook = { columns: 2, rows: 2, frames: 4, fps: 10, loop: "loop" };
    await apply(effect);
    const mesh = hoverMeshes()[0]!;
    const texture = (mesh.material as THREE.MeshBasicMaterial).map!;
    expect(texture.repeat.toArray()).toEqual([0.5, 0.5]);
    expect(texture.offset.toArray()).toEqual([0, 0.5]);
    // One 100 × 50 frame: the plane keeps the frame's 2:1 aspect.
    const geometry = mesh.geometry as THREE.PlaneGeometry;
    expect(geometry.parameters.width / geometry.parameters.height).toBeCloseTo(
      2,
    );
    controller.update(0.1);
    expect(texture.offset.toArray()).toEqual([0.5, 0.5]);
    controller.update(0.1);
    expect(texture.offset.toArray()).toEqual([0, 0]);
  });

  it("draws composite flipbook frames through a source rectangle", async () => {
    const effect = decalEffect();
    effect.flipbook = { columns: 2, rows: 1, frames: 2, fps: 30, loop: "once" };
    await apply(effect);
    expect(lastDraw()?.source).toEqual([0, 0, 100, 100]);
    controller.update(1 / 30);
    expect(lastDraw()?.source).toEqual([100, 0, 100, 100]);
    controller.update(1);
    expect(lastDraw()?.source).toEqual([100, 0, 100, 100]);
  });

  it("evaluates keyframes on the effect timeline and combines them with presets", async () => {
    const effect = decalEffect();
    effect.keyframes = {
      loop: false,
      frames: [
        { t: 0, opacity: 0 },
        { t: 1, opacity: 1 },
      ],
    };
    await apply(effect);
    expect(lastDraw()).toBeUndefined();
    controller.update(0.5);
    expect(lastDraw()?.alpha).toBeCloseTo(0.5, 1);
    controller.update(2);
    expect(lastDraw()?.alpha).toBeCloseTo(1);
  });

  it("holds an intensity set while the effect is still loading", async () => {
    let release!: (value: HTMLCanvasElement) => void;
    vi.mocked(loadEffectImage).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const effect = eyeEffect();
    const applying = apply(effect);
    controller.setEffectIntensity(effect.id, 0.3);
    release(image as unknown as HTMLCanvasElement);
    await applying;
    const material = hoverMeshes()[0]!.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(0.3);
    controller.setEffectIntensity(effect.id, 1);
    expect(material.opacity).toBeCloseTo(1);
  });

  it("stops redrawing a composite once its fade settles at full intensity", async () => {
    const effect = decalEffect();
    await apply(effect);
    const imageDraws = () =>
      allDraws().filter((draw) => draw.image === image).length;
    controller.setEffectIntensity(effect.id, 0.5);
    const fading = imageDraws();
    controller.update(1 / 30);
    expect(imageDraws()).toBeGreaterThan(fading);
    controller.setEffectIntensity(effect.id, 1);
    const settled = imageDraws();
    controller.update(1 / 30);
    controller.update(1 / 30);
    expect(imageDraws()).toBe(settled);
  });

  it("drops a pending intensity when its apply fails", async () => {
    const effect = eyeEffect();
    controller.setEffectIntensity(effect.id, 0.2);
    vi.mocked(loadEffectImage).mockRejectedValueOnce(new Error("broken"));
    await apply(effect);
    expect(hoverMeshes()).toHaveLength(0);
    await apply(effect);
    const material = hoverMeshes()[0]!.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(1);
  });

  it("drops a pending intensity when its effect is removed first", async () => {
    const effect = eyeEffect();
    controller.setEffectIntensity(effect.id, 0.2);
    controller.removeEffect(effect.id);
    await apply(effect);
    const material = hoverMeshes()[0]!.material as THREE.MeshBasicMaterial;
    expect(material.opacity).toBeCloseTo(1);
  });

  it("reports body, sticker and silhouette attachments as not yet supported", () => {
    controller.reportUnsupportedAttachment({
      kind: "deferred_attachment",
      attachmentKind: "sticker",
      id: "sticker",
      label: "Doki",
      description: "",
      assetPath: "blob:x",
      region: "sticker",
    });
    expect(controller.getSnapshot().warnings.join(" ")).toMatch(
      /sticker attachment, which is not yet supported/,
    );
  });
});
