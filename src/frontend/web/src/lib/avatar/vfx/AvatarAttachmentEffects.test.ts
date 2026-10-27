import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Avatar } from "../Avatar";
import type { AnimaPoseClipEventSink } from "../poses/PoseController";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import {
  BODY_RENDER_ORDER,
  MAX_ACTIVE_ATTACHMENT_EFFECTS,
  STICKER_RENDER_ORDER,
} from "./AvatarAttachmentEffects";
import { AvatarVFXController } from "./AvatarVFXController";
import { parseAvatarEffectDefinition } from "./definition";
import { loadEffectImage } from "./effect-image";
import { SILHOUETTE_RENDER_ORDER } from "./silhouetteOverlay";
import type { AvatarVFXAttachmentEntry } from "./types";

vi.mock("../vrmEditorInspection", () => ({
  buildRuntimePrimitiveBindings: vi.fn(),
}));
vi.mock("./effect-image", () => ({ loadEffectImage: vi.fn() }));

/** Art is 200×100, so planes are twice as wide as they are tall. */
const ART = { width: 200, height: 100 };
const AVATAR_HEIGHT = 1.5;

type Rig = {
  avatar: Avatar;
  scene: THREE.Group;
  hips: THREE.Bone;
  chest: THREE.Bone;
  head: THREE.Bone;
  body: THREE.SkinnedMesh;
  iris: THREE.Mesh;
  bodyMaterial: THREE.MeshBasicMaterial;
  outlineMaterial: THREE.MeshBasicMaterial;
};

/**
 * A minimal humanoid: hips → chest → head bones, a skinned body with an
 * outline material (as three-vrm adds for MToon) and morph targets, and a
 * transparent iris layer that writes no depth.
 */
function createRig(metaVersion: "0" | "1" = "1"): Rig {
  const scene = new THREE.Group();
  if (metaVersion === "0") scene.rotation.y = Math.PI;
  const hips = new THREE.Bone();
  hips.position.set(0, 0.8, 0);
  const chest = new THREE.Bone();
  chest.position.set(0, 0.3, 0);
  const head = new THREE.Bone();
  head.position.set(0, 0.25, 0);
  hips.add(chest);
  chest.add(head);
  scene.add(hips);

  const geometry = new THREE.BoxGeometry(0.4, AVATAR_HEIGHT, 0.2);
  geometry.translate(0, AVATAR_HEIGHT / 2, 0);
  const count = geometry.getAttribute("position").count;
  geometry.setAttribute(
    "skinIndex",
    new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0), 4),
  );
  geometry.setAttribute(
    "skinWeight",
    new THREE.Float32BufferAttribute(
      Array.from({ length: count }, () => [1, 0, 0, 0]).flat(),
      4,
    ),
  );
  geometry.morphAttributes.position = [
    geometry.getAttribute("position").clone(),
  ];
  geometry.addGroup(0, geometry.index!.count, 0);
  geometry.addGroup(0, geometry.index!.count, 1);
  const bodyMaterial = new THREE.MeshBasicMaterial({
    map: new THREE.Texture(),
    alphaTest: 0.5,
  });
  bodyMaterial.name = "Body";
  const outlineMaterial = new THREE.MeshBasicMaterial();
  (outlineMaterial as unknown as { isOutline: boolean }).isOutline = true;
  const body = new THREE.SkinnedMesh(geometry, [bodyMaterial, outlineMaterial]);
  body.name = "Body";
  body.bind(new THREE.Skeleton([hips, chest, head]));
  scene.add(body);

  const irisMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
  });
  irisMaterial.name = "Iris";
  const iris = new THREE.Mesh(
    new THREE.PlaneGeometry(0.02, 0.02),
    irisMaterial,
  );
  head.add(iris);
  scene.updateMatrixWorld(true);

  const bones: Record<string, THREE.Object3D> = { hips, chest, head };
  const avatar = {
    sourceUrl: null,
    sourceKey: null,
    facePartMap: null,
    scene,
    vrm: {
      meta: { metaVersion },
      humanoid: {
        getNormalizedBoneNode: (name: string) => bones[name] ?? null,
      },
    },
    faceLandmarks: null,
    getFaceLandmarksSnapshot: () => null,
    getFaceTextureAnchorsSnapshot: () => null,
    setExpression: vi.fn(),
    clearExpressionOverride: vi.fn(),
  } as unknown as Avatar;
  vi.mocked(buildRuntimePrimitiveBindings).mockReturnValue({
    entries: [body, iris].map((object) => ({
      bindingKey: object.name || "iris",
      materialName: object === body ? "Body" : "Iris",
      object,
      materialIndex: 0,
      nodeIndex: 0,
      meshIndex: 0,
      primitiveIndex: object === body ? 0 : 1,
      visible: true,
      isSkinnedMesh: object === body,
      objectName: object.name,
      objectType: object.type,
      originalVisible: true,
    })),
    warnings: [],
  } as unknown as ReturnType<typeof buildRuntimePrimitiveBindings>);
  return {
    avatar,
    scene,
    hips,
    chest,
    head,
    body,
    iris,
    bodyMaterial,
    outlineMaterial,
  };
}

function entry(
  id: string,
  region: "body" | "sticker" | "silhouette",
  attachment: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): AvatarVFXAttachmentEntry {
  return parseAvatarEffectDefinition(
    {
      schema: "animama/avatar-effect/2",
      region,
      attachment: { kind: region, ...attachment },
      art: { image: "art.png" },
      ...extra,
    },
    { id, label: id, description: id, assetPath: `blob:${id}` },
  ) as AvatarVFXAttachmentEntry;
}

const named = (root: THREE.Object3D, prefix: string) => {
  const found: THREE.Object3D[] = [];
  root.traverse((object) => {
    if (object.name.startsWith(prefix)) found.push(object);
  });
  return found;
};

/** Run a mesh's per-render hook for `camera`, as WebGLRenderer does. */
function renderHook(mesh: THREE.Object3D, camera: THREE.Camera) {
  const renderer = {
    getCurrentViewport: (target: THREE.Vector4) => target.set(0, 0, 800, 600),
  } as unknown as THREE.WebGLRenderer;
  mesh.onBeforeRender(
    renderer,
    new THREE.Scene(),
    camera,
    (mesh as THREE.Mesh).geometry,
    (mesh as THREE.Mesh).material as THREE.Material,
    null as never,
  );
}

describe("body, sticker and silhouette Avatar Effects", () => {
  let rig: Rig;
  let controller: AvatarVFXController;
  const controllers: AvatarVFXController[] = [];
  const camera = new THREE.PerspectiveCamera();

  const create = (metaVersion: "0" | "1" = "1") => {
    rig = createRig(metaVersion);
    controller = new AvatarVFXController(rig.avatar);
    controllers.push(controller);
    return controller;
  };
  const apply = (value: AvatarVFXAttachmentEntry, appliedId = value.id) =>
    controller.applyAttachmentVFX({
      effectId: appliedId,
      effectEntry: { ...value, id: appliedId },
      logicalEffectId: value.id,
    });

  beforeEach(() => {
    vi.mocked(loadEffectImage).mockResolvedValue(
      ART as unknown as HTMLImageElement,
    );
    camera.position.set(0.3, 1.4, 2);
    camera.lookAt(0, 1.2, 0);
    camera.updateMatrixWorld(true);
    create();
  });
  afterEach(() => {
    controllers.splice(0).forEach((value) => value.dispose());
  });

  describe("body planes", () => {
    it("parents to the bone, sizes by metres and faces the camera", async () => {
      await apply(
        entry("heart", "body", {
          bone: "chest",
          offset: { x: 0.05, y: 0.1, z: 0.2 },
          size: 0.3,
        }),
      );
      const [plane] = named(rig.chest, "AvatarAttachmentVFX:heart");
      expect(plane).toBeInstanceOf(THREE.Mesh);
      const mesh = plane as THREE.Mesh;
      expect(mesh.renderOrder).toBe(BODY_RENDER_ORDER);
      const size = mesh.geometry.getAttribute("position");
      expect(size.getY(0) - size.getY(2)).toBeCloseTo(0.3);
      expect(size.getX(1) - size.getX(0)).toBeCloseTo(0.6);

      rig.chest.rotation.set(0.4, 0.8, 0);
      rig.scene.updateMatrixWorld(true);
      renderHook(mesh, camera);
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      mesh.matrixWorld.decompose(position, rotation, new THREE.Vector3());
      // The bone's frame carries the offset; the camera sets the facing.
      const expected = new THREE.Vector3(0.05, 0.1, 0.2).applyMatrix4(
        rig.chest.matrixWorld,
      );
      expect(position.distanceTo(expected)).toBeLessThan(1e-6);
      expect(rotation.angleTo(camera.quaternion)).toBeLessThan(1e-6);
      expect(controller.getSnapshot().attachmentEffects).toEqual([
        expect.objectContaining({
          effectId: "heart",
          attachmentKind: "body",
          renderMode: "body_plane",
          target: "chest",
        }),
      ]);
    });

    it("keeps a bone-facing plane in front of the avatar on both VRM versions", async () => {
      for (const version of ["1", "0"] as const) {
        create(version);
        await apply(
          entry("badge", "body", {
            bone: "chest",
            offset: { z: 0.2 },
            facing: "bone",
          }),
        );
        const [plane] = named(rig.chest, "AvatarAttachmentVFX:badge");
        rig.scene.updateMatrixWorld(true);
        const world = plane!.getWorldPosition(new THREE.Vector3());
        const chest = rig.chest.getWorldPosition(new THREE.Vector3());
        // Both versions face +Z in the world after load.
        expect(world.z - chest.z).toBeCloseTo(0.2);
        const normal = new THREE.Vector3(0, 0, 1).transformDirection(
          plane!.matrixWorld,
        );
        expect(normal.z).toBeCloseTo(1);
      }
    });

    it("falls back along the bone chain and reports the resolved bone", async () => {
      await apply(entry("hand", "body", { bone: "leftHand" }));
      expect(controller.getSnapshot().attachmentEffects[0]!.target).toBe(
        "leftHand→chest",
      );
      expect(named(rig.chest, "AvatarAttachmentVFX:hand")).toHaveLength(1);
    });
  });

  describe("stickers", () => {
    it("sizes and offsets in avatar heights, in the screen plane, over the avatar", async () => {
      await apply(
        entry("doki", "sticker", {
          around: "head",
          offset: { x: 0.2, y: 0.1 },
          size: 0.2,
          rotationDeg: 30,
        }),
      );
      const [sticker] = named(rig.scene, "AvatarAttachmentVFX:doki");
      const mesh = sticker as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshBasicMaterial
      >;
      expect(mesh.renderOrder).toBe(STICKER_RENDER_ORDER);
      expect(mesh.material.depthTest).toBe(false);

      // Scaling the avatar scales the sticker with it.
      rig.scene.scale.setScalar(2);
      rig.scene.updateMatrixWorld(true);
      renderHook(mesh, camera);
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      const scale = new THREE.Vector3();
      mesh.matrixWorld.decompose(position, rotation, scale);
      const height = AVATAR_HEIGHT * 2;
      const head = rig.head.getWorldPosition(new THREE.Vector3());
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        camera.quaternion,
      );
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const expected = head
        .addScaledVector(right, 0.2 * height)
        .addScaledVector(up, 0.1 * height);
      expect(position.distanceTo(expected)).toBeLessThan(1e-6);
      // Plane height 0.2 avatar heights, scaled to world units.
      expect(scale.y * 0.2).toBeCloseTo(0.2 * height);
      const facing = camera.quaternion
        .clone()
        .multiply(
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 0, 1),
            Math.PI / 6,
          ),
        );
      expect(rotation.angleTo(facing)).toBeLessThan(1e-6);
    });

    it("centres a body sticker between the hips and the head", async () => {
      await apply(entry("note", "sticker", { around: "body" }));
      const [sticker] = named(rig.scene, "AvatarAttachmentVFX:note");
      renderHook(sticker!, camera);
      const position = new THREE.Vector3().setFromMatrixPosition(
        sticker!.matrixWorld,
      );
      const centre = rig.hips
        .getWorldPosition(new THREE.Vector3())
        .add(rig.head.getWorldPosition(new THREE.Vector3()))
        .multiplyScalar(0.5);
      expect(position.distanceTo(centre)).toBeLessThan(1e-6);
    });
  });

  describe("plane lifetime and cameras", () => {
    const planeParts = (root: THREE.Object3D, prefix: string) => {
      const [object] = named(root, prefix);
      const mesh = object as THREE.Mesh<
        THREE.PlaneGeometry,
        THREE.MeshBasicMaterial
      >;
      return {
        geometry: vi.spyOn(mesh.geometry, "dispose"),
        material: vi.spyOn(mesh.material, "dispose"),
        texture: vi.spyOn(mesh.material.map!, "dispose"),
      };
    };

    it.each([
      ["body", { bone: "chest" }],
      ["sticker", {}],
    ] as const)(
      "disposes a %s plane's geometry, material and texture on removal",
      async (kind, attachment) => {
        await apply(entry("gone", kind, attachment));
        const parts = planeParts(rig.scene, "AvatarAttachmentVFX:gone");
        controller.removeEffect("gone");
        expect(named(rig.scene, "AvatarAttachmentVFX:")).toEqual([]);
        expect(parts.geometry).toHaveBeenCalledOnce();
        expect(parts.material).toHaveBeenCalledOnce();
        expect(parts.texture).toHaveBeenCalledOnce();
      },
    );

    it("disposes planes when the controller is disposed", async () => {
      await apply(entry("heart", "body", { bone: "chest" }));
      await apply(entry("doki", "sticker", {}));
      const body = planeParts(rig.chest, "AvatarAttachmentVFX:heart");
      const sticker = planeParts(rig.scene, "AvatarAttachmentVFX:doki");
      controller.dispose();
      for (const parts of [body, sticker]) {
        expect(parts.geometry).toHaveBeenCalledOnce();
        expect(parts.material).toHaveBeenCalledOnce();
        expect(parts.texture).toHaveBeenCalledOnce();
      }
      expect(named(rig.scene, "AvatarAttachmentVFX:")).toEqual([]);
    });

    it("faces each camera that draws it", async () => {
      await apply(entry("heart", "body", { bone: "chest" }));
      await apply(entry("doki", "sticker", { offset: { x: 0.2 } }));
      const side = new THREE.PerspectiveCamera();
      side.position.set(-2, 1.3, 0.5);
      side.lookAt(0, 1.2, 0);
      side.updateMatrixWorld(true);
      for (const prefix of [
        "AvatarAttachmentVFX:heart",
        "AvatarAttachmentVFX:doki",
      ]) {
        const [mesh] = named(rig.scene, prefix);
        for (const view of [camera, side, camera]) {
          renderHook(mesh!, view);
          const rotation = new THREE.Quaternion();
          mesh!.matrixWorld.decompose(
            new THREE.Vector3(),
            rotation,
            new THREE.Vector3(),
          );
          expect(rotation.angleTo(view.quaternion)).toBeLessThan(1e-6);
        }
      }
      // A sticker's screen-plane offset follows the camera's right vector.
      const [sticker] = named(rig.scene, "AvatarAttachmentVFX:doki");
      const head = rig.head.getWorldPosition(new THREE.Vector3());
      for (const view of [camera, side]) {
        renderHook(sticker!, view);
        const position = new THREE.Vector3().setFromMatrixPosition(
          sticker!.matrixWorld,
        );
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
          view.quaternion,
        );
        expect(
          position.distanceTo(
            head.clone().addScaledVector(right, 0.2 * AVATAR_HEIGHT),
          ),
        ).toBeLessThan(1e-6);
      }
    });
  });

  describe("silhouette overlays", () => {
    const overlays = () =>
      named(rig.scene, "AvatarSilhouetteVFX:") as THREE.SkinnedMesh[];

    it("overlays depth-writing primitives, sharing their geometry, skeleton and morphs", async () => {
      await apply(
        entry(
          "shade",
          "silhouette",
          { patternScale: 2 },
          {
            appearance: { opacity: 0.6, tint: "#3355ff", blend: "multiply" },
          },
        ),
      );
      const [overlay, ...others] = overlays();
      // The transparent iris layer gets none.
      expect(others).toEqual([]);
      expect(overlay).toBeInstanceOf(THREE.SkinnedMesh);
      expect(overlay!.parent).toBe(rig.body);
      expect(overlay!.position.lengthSq()).toBe(0);
      expect(overlay!.geometry).toBe(rig.body.geometry);
      expect(overlay!.skeleton).toBe(rig.body.skeleton);
      expect(overlay!.morphTargetInfluences).toBe(
        rig.body.morphTargetInfluences,
      );
      expect(overlay!.renderOrder).toBe(SILHOUETTE_RENDER_ORDER);
      // One material draws each triangle once, so the outline group is unused.
      const material = overlay!.material as THREE.ShaderMaterial;
      expect(Array.isArray(overlay!.material)).toBe(false);
      expect(material.depthFunc).toBe(THREE.LessEqualDepth);
      expect(material.polygonOffset).toBe(true);
      expect(material.depthWrite).toBe(false);
      expect(material.uniforms.sourceMap!.value).toBe(rig.bodyMaterial.map);
      expect(material.uniforms.sourceAlphaTest!.value).toBe(0.5);
      expect(material.uniforms.opacity!.value).toBeCloseTo(0.6);
      expect(material.blending).toBe(THREE.CustomBlending);
      // The avatar's own materials are untouched.
      expect(rig.body.material).toEqual([
        rig.bodyMaterial,
        rig.outlineMaterial,
      ]);

      renderHook(overlay!, camera);
      const tile = material.uniforms.tileSize!.value as THREE.Vector2;
      // 200×100 art: tiles keep its aspect.
      expect(tile.x / tile.y).toBeCloseTo(2);
    });

    it("removes its overlays without disposing what the avatar owns", async () => {
      const geometryDispose = vi.spyOn(rig.body.geometry, "dispose");
      const materialDispose = vi.spyOn(rig.bodyMaterial, "dispose");
      const mapDispose = vi.spyOn(rig.bodyMaterial.map!, "dispose");
      await apply(entry("shade", "silhouette", {}));
      const [overlay] = overlays();
      const overlayDispose = vi.spyOn(
        overlay!.material as THREE.Material,
        "dispose",
      );
      controller.removeEffect("shade");
      expect(overlays()).toEqual([]);
      expect(overlayDispose).toHaveBeenCalledOnce();
      expect(geometryDispose).not.toHaveBeenCalled();
      expect(materialDispose).not.toHaveBeenCalled();
      expect(mapDispose).not.toHaveBeenCalled();
      expect(controller.getSnapshot().attachmentEffects).toEqual([]);
    });

    it("ignores map alpha on a primitive without cutout or blending", async () => {
      rig.bodyMaterial.alphaTest = 0;
      await apply(entry("shade", "silhouette", {}));
      const material = overlays()[0]!.material as THREE.ShaderMaterial;
      expect(material.uniforms.useSourceMap!.value).toBe(0);
      expect(material.uniforms.sourceMap!.value).toBeNull();
      expect(material.uniforms.sourceAlphaTest!.value).toBe(0);
      expect(material.uniforms.sourceOpacity!.value).toBe(1);
    });

    it("scrolls the pattern on the effect's timeline", async () => {
      await apply(entry("rain", "silhouette", { scroll: { x: 0, y: -0.5 } }));
      const material = overlays()[0]!.material as THREE.ShaderMaterial;
      controller.update(1);
      const offset = material.uniforms.patternOffset!.value as THREE.Vector2;
      expect(offset.y).toBeCloseTo(-0.5);
    });
  });

  describe("coexistence", () => {
    it("removes the oldest beyond the cap, with a diagnostic", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const ids = ["a", "b", "c", "d", "e"];
      for (const id of ids) {
        await apply(entry(id, "sticker", {}), `clip:${id}`);
      }
      const active = controller.getSnapshot().attachmentEffects;
      expect(active.map((effect) => effect.effectId)).toEqual(ids.slice(1));
      expect(active).toHaveLength(MAX_ACTIVE_ATTACHMENT_EFFECTS);
      expect(named(rig.scene, "AvatarAttachmentVFX:clip:a")).toEqual([]);
      expect(controller.getSnapshot().warnings).toEqual([
        'Removed "a": at most 4 body, sticker or silhouette effects can be active.',
      ]);
      expect(controller.getSnapshot().issues).toEqual([
        {
          code: "effect_attachment_limit",
          params: { effectId: "a", limit: MAX_ACTIVE_ATTACHMENT_EFFECTS },
        },
      ]);
      expect(warn.mock.calls[0]![1]).toMatchObject({
        code: "avatar_effect_attachment_limit",
        removedEffectId: "a",
        appliedEffectId: "clip:a",
        addedEffectId: "e",
      });
      // The evicted effect's owner may still remove it; nothing happens.
      controller.removeEffect("clip:a");
      expect(controller.getSnapshot().attachmentEffects).toHaveLength(4);
    });

    it("replaces a re-applied ID without counting it twice", async () => {
      const value = entry("same", "body", { bone: "head" });
      await apply(value);
      await apply(value);
      expect(controller.getSnapshot().attachmentEffects).toHaveLength(1);
      expect(named(rig.head, "AvatarAttachmentVFX:same")).toHaveLength(1);
    });

    it("keeps attachments through a face part refresh and clears them on clear", async () => {
      await apply(entry("heart", "body", { bone: "chest" }));
      await apply(entry("shade", "silhouette", {}));
      await controller.refreshFaceParts();
      expect(
        controller
          .getSnapshot()
          .attachmentEffects.map((value) => value.effectId),
      ).toEqual(["heart", "shade"]);
      expect(controller.getObservationSnapshot().activeEffects).toEqual([
        expect.objectContaining({
          effectId: "heart",
          targetRole: "body",
          renderMode: "body_plane",
        }),
        expect.objectContaining({
          effectId: "shade",
          targetRole: "silhouette",
          renderMode: "silhouette_overlay",
        }),
      ]);
      controller.clearAllEffects();
      expect(controller.getSnapshot().attachmentEffects).toEqual([]);
      expect(named(rig.scene, "AvatarAttachmentVFX:")).toEqual([]);
      expect(named(rig.scene, "AvatarSilhouetteVFX:")).toEqual([]);
    });

    it("does not apply an effect removed while its art loads", async () => {
      let release!: () => void;
      vi.mocked(loadEffectImage).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => resolve(ART as unknown as HTMLImageElement);
          }),
      );
      const pending = apply(entry("late", "sticker", {}), "clip:late");
      controller.removeEffect("clip:late");
      release();
      await pending;
      expect(controller.getSnapshot().attachmentEffects).toEqual([]);
      expect(named(rig.scene, "AvatarAttachmentVFX:")).toEqual([]);
    });

    it("fades with the event envelope, holding a value set before apply", async () => {
      controller.setEffectIntensity("fade", 0.25);
      await apply(
        entry("fade", "sticker", {}, { appearance: { opacity: 0.8 } }),
      );
      const [sticker] = named(rig.scene, "AvatarAttachmentVFX:fade");
      const material = (sticker as THREE.Mesh)
        .material as THREE.MeshBasicMaterial;
      expect(material.opacity).toBeCloseTo(0.2);
      controller.setEffectIntensity("fade", 1);
      expect(material.opacity).toBeCloseTo(0.8);
    });
  });

  describe("clip-owned", () => {
    /** A real Avatar's Gesture sink driving this rig's controller. */
    const clipFixture = () => {
      const effect = entry("doki", "sticker", {});
      const loadAvatarVFX = vi.fn().mockResolvedValue(effect);
      const avatar = new Avatar(new THREE.PerspectiveCamera(), null, {
        mediaCatalog: { loadAvatarVFX } as unknown as NonNullable<
          ConstructorParameters<typeof Avatar>[2]
        >["mediaCatalog"],
      });
      vi.spyOn(avatar, "isReady", "get").mockReturnValue(true);
      avatar.vfxController = controller;
      let sink: AnimaPoseClipEventSink = {};
      avatar.poseController = {
        setClipEventSink: (value: AnimaPoseClipEventSink) => {
          sink = value;
        },
      } as unknown as NonNullable<Avatar["poseController"]>;
      avatar.setPoseClipExternalEventSink({});
      const event = {
        id: "event",
        time: 0,
        kind: "avatar_vfx" as const,
        effectId: "doki",
      };
      const context = {
        clipId: "clip",
        eventId: "event",
        appliedId: "clip:event",
        playbackTime: 0,
        clipTime: 0,
        occurrenceIndex: 0,
      };
      return { avatar, sink, event, context };
    };
    const stickers = () => named(rig.scene, "AvatarAttachmentVFX:");

    it("applies under the occurrence ID and disposes when the clip clears it", async () => {
      const { sink, event, context } = clipFixture();
      await sink.applyAvatarVFX?.(event, context);
      expect(controller.getSnapshot().attachmentEffects).toEqual([
        expect.objectContaining({
          appliedEffectId: "clip:event",
          effectId: "doki",
        }),
      ]);
      sink.clearAvatarVFX?.(event, context);
      expect(controller.getSnapshot().attachmentEffects).toEqual([]);
      expect(stickers()).toEqual([]);
    });

    it("respects disabled clip effects (presentation.disable_vfx)", async () => {
      const { avatar, sink, event, context } = clipFixture();
      await sink.applyAvatarVFX?.(event, context);
      avatar.setClipVFXEnabled(false);
      expect(stickers()).toEqual([]);
      await sink.applyAvatarVFX?.(event, context);
      expect(controller.getSnapshot().attachmentEffects).toEqual([]);
    });
  });

  describe("in-place transforms", () => {
    it("moves, resizes and turns a body plane without reloading its art", async () => {
      await apply(
        entry(
          "heart",
          "body",
          { bone: "chest", size: 0.2 },
          {
            motion: { pulse: {} },
          },
        ),
      );
      const [plane] = named(rig.chest, "AvatarAttachmentVFX:heart");
      const mesh = plane as THREE.Mesh;
      const material = mesh.material;
      controller.update(0.5);
      vi.mocked(loadEffectImage).mockClear();

      expect(
        controller.updateEffectTransform("heart", {
          kind: "body",
          offset: { x: 0.1, y: 0.02, z: 0.3 },
          size: 0.4,
          rotation: Math.PI / 6,
        }),
      ).toBe(true);

      expect(loadEffectImage).not.toHaveBeenCalled();
      expect(named(rig.chest, "AvatarAttachmentVFX:heart")).toEqual([mesh]);
      expect(mesh.material).toBe(material);
      expect(mesh.rotation.z).toBeCloseTo(Math.PI / 6);
      const size = mesh.geometry.getAttribute("position");
      expect(size.getY(0) - size.getY(2)).toBeCloseTo(0.4);
      expect(size.getX(1) - size.getX(0)).toBeCloseTo(0.8);
      expect(mesh.parent!.parent!.position.toArray()).toEqual([0.1, 0.02, 0.3]);

      const frame = controller.getManipulationFrame("heart", camera)!;
      expect(frame.attachment).toBe("body");
      // Offsets are measured in the bone's front frame.
      const anchor = new THREE.Vector3(0.1, 0.02, 0.3).applyMatrix4(
        frame.offsetSpace!,
      );
      expect(frame.placements[0]!.center.distanceTo(anchor)).toBeLessThan(0.05);
    });

    it("moves a sticker in the screen plane and reports its height unit", async () => {
      await apply(
        entry("doki", "sticker", { offset: { x: 0, y: 0 }, size: 0.2 }),
      );
      const [sticker] = named(rig.scene, "AvatarAttachmentVFX:doki");
      expect(
        controller.updateEffectTransform("doki", {
          kind: "sticker",
          offset: { x: 0.25, y: -0.1 },
          size: 0.3,
          rotation: 0,
        }),
      ).toBe(true);
      renderHook(sticker!, camera);
      const position = new THREE.Vector3().setFromMatrixPosition(
        sticker!.matrixWorld,
      );
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(
        camera.quaternion,
      );
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      const expected = rig.head
        .getWorldPosition(new THREE.Vector3())
        .addScaledVector(right, 0.25 * AVATAR_HEIGHT)
        .addScaledVector(up, -0.1 * AVATAR_HEIGHT);
      expect(position.distanceTo(expected)).toBeLessThan(1e-6);

      const frame = controller.getManipulationFrame("doki", camera)!;
      expect(frame.attachment).toBe("sticker");
      expect(frame.unitLength).toBeCloseTo(AVATAR_HEIGHT);
      expect(frame.placements[0]!.center.distanceTo(expected)).toBeLessThan(
        1e-6,
      );
    });

    it("refuses a transform for another attachment or an inactive effect", async () => {
      await apply(entry("doki", "sticker", {}));
      expect(
        controller.updateEffectTransform("doki", {
          kind: "body",
          offset: { x: 0, y: 0, z: 0 },
          size: 1,
          rotation: 0,
        }),
      ).toBe(false);
      expect(
        controller.updateEffectTransform("missing", {
          kind: "sticker",
          offset: { x: 0, y: 0 },
          size: 1,
          rotation: 0,
        }),
      ).toBe(false);
      await apply(entry("tiles", "silhouette", {}));
      expect(controller.getManipulationFrame("tiles", camera)).toBeNull();
    });
  });
});
