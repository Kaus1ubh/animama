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
  AvatarFaceAnchoredVFXEntry,
  AvatarFaceAnchoredSingleDecalVFXEntry,
  AvatarHoverVFXEntry,
  AvatarVFXCatalogEntry,
} from "./types";

vi.mock("../vrmEditorInspection", () => ({
  buildRuntimePrimitiveBindings: vi.fn(),
}));
vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/** Record canvas drawing transforms independently of the guide projection. */
class TestCanvas {
  width = 200;
  height = 100;
  draws: { image: unknown; points: THREE.Vector3[] }[] = [];
  getContext() {
    let matrix = new THREE.Matrix4();
    const stack: THREE.Matrix4[] = [];
    return {
      save: () => stack.push(matrix.clone()),
      restore: () => {
        matrix = stack.pop()!;
      },
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
      drawImage: (image: unknown, x: number, y: number, w: number, h: number) =>
        this.draws.push({
          image,
          points: [
            [x, y],
            [x + w, y],
            [x + w, y + h],
            [x, y + h],
          ].map(([px, py]) =>
            new THREE.Vector3(px, py, 0).applyMatrix4(matrix),
          ),
        }),
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

describe("read-only placement guides", () => {
  let controller: AvatarVFXController;
  let anchor: THREE.Group;
  let landmarks: AvatarFaceLandmarksSnapshot;
  let anchors: AvatarFaceTextureAnchorsSnapshot;
  let image: TestCanvas;
  let originalTexture: TestCanvas;
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

  it("shows only selected reference anchors before upload, without loading or applying artwork", () => {
    const effect = eyeEffect();
    const guide = controller.getPlacementGuides(effect, "preview");
    expect(guide.active).toBe(false);
    expect(guide.spatial).toHaveLength(1);
    expect(guide.spatial[0]?.label).toBe("Eye left");
    expect(guide.spatial[0]?.reference).toEqual(vec(0.04, 0.02, 0.0305));
    expect(guide.spatial[0]?.artwork).toEqual([]);
    expect(loadEffectImage).not.toHaveBeenCalled();
  });

  it("projects the actual non-square, rotated hover mesh and follows the same animated transform", async () => {
    const effect = eyeEffect();
    effect.transform.rotation.z = Math.PI / 2;
    effect.animationConfig = {
      driftPerSecond: { x: 0.25, y: 0 },
      rotationRadiansPerSecond: 1,
      pulseScaleMin: 1,
      pulseScaleMax: 2,
    };
    await apply(effect);
    const first = controller.getPlacementGuides(effect, "preview").spatial[0]!;
    const width = Math.abs(first.artwork[1]!.y - first.artwork[0]!.y);
    expect(width).toBeCloseTo(0.12 * 1.5);
    controller.update(0.2);
    const guide = controller.getPlacementGuides(effect, "preview");
    const mesh = anchor.getObjectByName("preview:left") as THREE.Mesh;
    mesh.updateWorldMatrix(true, false);
    const positions = mesh.geometry.getAttribute("position");
    const actual = new THREE.Vector3()
      .fromBufferAttribute(positions, 0)
      .applyMatrix4(mesh.matrixWorld);
    expect(guide.spatial[0]!.artwork[0]!.x).toBeCloseTo(actual.x);
    expect(guide.spatial[0]!.artwork[0]!.y).toBeCloseTo(actual.y);
    expect(guide.spatial[0]!.artwork).not.toEqual(first.artwork);
    expect(loadEffectImage).toHaveBeenCalledTimes(1);
    controller.removeEffect("preview");
    expect(
      controller.getPlacementGuides(effect, "preview").spatial[0]!.artwork,
    ).toEqual([]);
  });

  it("keeps coordinates head-local while exposing the live anchor", async () => {
    const effect = eyeEffect();
    await apply(effect);
    const before = controller.getPlacementGuides(effect, "preview");
    anchor.position.set(1, 2, 3);
    anchor.rotation.y = 0.8;
    const after = controller.getPlacementGuides(effect, "preview");
    expect(after.anchor).toBe(anchor);
    after.spatial[0]!.artwork.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before.spatial[0]!.artwork[i]!.x);
      expect(p.y).toBeCloseTo(before.spatial[0]!.artwork[i]!.y);
    });
  });

  it("follows eye mirror selection and box placement without adding unrelated UV guides", async () => {
    const eyes = eyeEffect();
    if (eyes.hoverKind !== "eye_hover") throw new Error("Wrong fixture");
    eyes.requiresMirror = true;
    await apply(eyes);
    expect(
      controller
        .getPlacementGuides(eyes, "preview")
        .spatial.map((guide) => guide.label),
    ).toEqual(["Eye left", "Eye right"]);
    const box: AvatarHoverVFXEntry = {
      ...base(),
      kind: "hover",
      hoverKind: "box_hover",
      placement: "top-edge-left-corner",
      region: "emote",
    };
    await apply(box);
    const guides = controller.getPlacementGuides(box, "preview");
    expect(guides.faceBounds).toEqual(bounds);
    expect(guides.spatial[0]!.reference).toEqual(vec(0.1, 0.12, 0.06));
    expect(guides.spatial[0]!.artwork).toHaveLength(4);
    expect(guides.surfaces).toEqual([]);
  });

  it("uses only active relevant flatten coverage and its skin sample", async () => {
    anchors.flatten.sample.center = {
      ...textureAnchor(null, 0.5),
      region: "sample",
    };
    anchors.flatten.eyes.left = {
      ...textureAnchor("left", 0.25),
      region: "eye",
    };
    anchors.flatten.eyes.right = {
      ...textureAnchor("right", 0.75),
      region: "eye",
    };
    anchors.flatten.mouth.center = {
      ...textureAnchor(null, 0.5),
      region: "mouth",
    };
    const eyes = eyeEffect();
    await apply(eyes);
    const coverage = controller.getPlacementGuides(eyes, "preview").surfaces[0]!
      .guides;
    expect(coverage.map((guide) => guide.label)).toEqual([
      "Flatten eye left",
      "Flatten eye right",
      "Skin sample",
    ]);
    expect(
      coverage
        .filter((guide) => guide.kind === "flatten")
        .every((guide) => guide.shape === "ellipse"),
    ).toBe(true);
    controller.removeEffect("preview");
    expect(controller.getPlacementGuides(eyes, "preview").surfaces).toEqual([]);

    const mouth: AvatarHoverVFXEntry = {
      ...base(),
      kind: "hover",
      hoverKind: "mouth_hover",
      region: "mouth",
    };
    await apply(mouth);
    const guide = controller.getPlacementGuides(mouth, "preview");
    expect(guide.spatial[0]!.source).toBe("fallback");
    expect(guide.surfaces[0]!.guides.map((item) => item.label)).toEqual([
      "Flatten mouth",
      "Skin sample",
    ]);
  });

  it("borrows the selected material and shows transformed texture bounds without face markers", async () => {
    const texture: AvatarVFXCatalogEntry = {
      ...base(),
      region: "full_face",
      kind: "texture",
      targetRole: "face_skin",
      assetShape: "full_face",
      applyMode: "replace",
    };
    texture.transform.scale.x = 0.5;
    texture.transform.offset = vec(0.1, 0.2);
    texture.transform.rotation.z = Math.PI / 2;
    const reference = controller.getPlacementGuides(texture, "preview");
    expect(reference.surfaces[0]!.image).toBe(originalTexture);
    expect(reference.surfaces[0]!.materialName).toBe("Face Skin");
    expect(reference.spatial).toEqual([]);
    expect(reference.messages).toContain("Target: Face Skin.");
    expect(
      reference.surfaces[0]!.guides.some((g) => g.kind === "artwork"),
    ).toBe(false);
    await apply(texture);
    expect(
      controller.getPlacementGuides(texture, "preview").messages,
    ).toContain("Target: Face Skin.");
    const artwork = controller
      .getPlacementGuides(texture, "preview")
      .surfaces[0]!.guides.find((g) => g.kind === "artwork")!;
    expect(artwork.points[0]!.x).toBeCloseTo(0.85);
    expect(artwork.points[0]!.y).toBeCloseTo(0.2);
    expect(artwork.points[2]!.x).toBeCloseTo(0.35);
    expect(artwork.points[2]!.y).toBeCloseTo(1.2);
    controller.removeEffect("preview");
    expect(
      controller.getPlacementGuides(texture, "preview").surfaces[0]!.image,
    ).toBe(originalTexture);
  });

  it("shows mouth hover depth from the original mouth anchor to the actual image plane", async () => {
    anchors.anchors.mouth.center!.localPoint = vec(0, -0.02, 0.02);
    const mouth: AvatarHoverVFXEntry = {
      ...base(),
      kind: "hover",
      hoverKind: "mouth_hover",
      region: "mouth",
    };
    mouth.transform.offset.z = 0.01;
    await apply(mouth);
    const guide = controller.getPlacementGuides(mouth, "preview").spatial[0]!;
    expect(guide.reference).toEqual(vec(0, -0.02, 0.02));
    const center = guide.artwork
      .reduce<THREE.Vector3>(
        (sum, p) => sum.add(new THREE.Vector3(p.x, p.y, p.z)),
        new THREE.Vector3(),
      )
      .multiplyScalar(0.25);
    // Runtime raises the plane 10% toward front Z .05, then adds authored Z .01.
    expect(center.z).toBeCloseTo(0.033);
    expect(center.z - guide.reference.z).toBeCloseTo(0.013);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 10);
    camera.position.set(1, 0, 1);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const projectedReference = new THREE.Vector3(
      guide.reference.x,
      guide.reference.y,
      guide.reference.z,
    ).project(camera);
    const projectedArtwork = center.clone().project(camera);
    expect(Math.abs(projectedArtwork.x - projectedReference.x)).toBeGreaterThan(
      0.01,
    );
  });

  it("uses mirrored pivot and image aspect ratio in decal footprints and borrows the live composite", async () => {
    const effect = decalEffect();
    effect.requiresMirror = true;
    effect.pivot = "top-left";
    effect.transform.offset.x = 0.05;
    await apply(effect);
    const projection = controller.getPlacementGuides(effect, "preview");
    const surface = projection.surfaces[0]!;
    expect(surface.image).not.toBe(originalTexture);
    const artwork = surface.guides.filter((g) => g.kind === "artwork");
    expect(artwork).toHaveLength(2);
    // A 2:1 image covers a .2 x .1 UV rectangle, anchored at each top corner.
    expect(artwork[0]!.points[0]!.x).toBeCloseTo(0.3);
    expect(artwork[0]!.points[0]!.y).toBeCloseTo(0.5);
    expect(artwork[0]!.points[2]!.x).toBeCloseTo(0.5);
    expect(artwork[1]!.points[0]!.x).toBeCloseTo(0.7);
    expect(artwork[1]!.points[2]!.x).toBeCloseTo(0.5);
    expect(artwork[0]!.pivot?.x).toBeCloseTo(0.3);
    expect(artwork[1]!.pivot?.x).toBeCloseTo(0.7);
  });

  it("combines span references and preserves only relevant fallback markers", () => {
    const effect: AvatarFaceAnchoredVFXEntry = {
      ...decalEffect(),
      layout: "span",
    };
    const span = controller.getPlacementGuides(effect, "preview");
    expect(span.spatial).toHaveLength(1);
    const ref = span.surfaces[0]!.guides.find((g) => g.kind === "reference")!;
    expect(ref.points[0]!.x).toBeCloseTo(0.2);
    expect(ref.points[1]!.x).toBeCloseTo(0.8);
    const mouth = controller.getPlacementGuides(
      { ...effect, anchor: "mouth", region: "mouth" },
      "preview",
    );
    expect(mouth.spatial[0]!.source).toBe("fallback");
    expect(mouth.messages.join(" ")).toMatch(/estimate/i);
  });

  it("matches animated canvas drawing, including authored rotation, without a guide clock", async () => {
    const effect = decalEffect();
    effect.transform.rotation.z = Math.PI / 2;
    effect.animationConfig = {
      driftPerSecond: { x: 0.1, y: 0.2 },
      rotationRadiansPerSecond: 0.5,
    };
    await apply(effect);
    controller.update(0.4);
    const guide = controller.getPlacementGuides(effect, "preview");
    const surface = guide.surfaces[0]!;
    const art = surface.guides.find((g) => g.kind === "artwork")!;
    const canvas = surface.image as unknown as TestCanvas;
    const drawing = canvas.draws.filter((d) => d.image === image).at(-1)!;
    art.points.forEach((p, i) => {
      expect(p.x).toBeCloseTo(drawing.points[i]!.x / surface.width);
      expect(p.y).toBeCloseTo(drawing.points[i]!.y / surface.height);
    });
    expect(controller.getPlacementGuides(effect, "preview")).toEqual(guide);
  });

  it("reports absent landmarks and releases surfaces after disposal", () => {
    landmarks.status = "unavailable";
    expect(
      controller.getPlacementGuides(eyeEffect(), "preview").messages.join(" "),
    ).toMatch(/landmark/i);
    controller.dispose();
    expect(
      controller.getPlacementGuides(decalEffect(), "preview").surfaces,
    ).toEqual([]);
  });
});
