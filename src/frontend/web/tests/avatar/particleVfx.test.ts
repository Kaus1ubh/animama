import { existsSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";

import type { Avatar } from "@/lib/avatar";
import {
  AVATAR_PARTICLE_VFX_CATALOG,
  PARTICLE_VFX_ROOT_OBJECT_NAME,
  ParticleVFXController,
  applyParticleVFXRectangleShapeAutoFit,
  classifyParticleVFXTextureUrl,
  getParticleVFXCatalogEntryById,
  getParticleVFXCombinedOffset,
  normalizeParticleVFXTransform,
  resolveParticleVFXAvatarBoundsRectangleFit,
  resolveParticleVFXAnchorLocalPosition,
} from "@/lib/avatar/particle-vfx";
import type { ParticleVFXCatalogEntry } from "@/lib/avatar/particle-vfx";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

const PHASE_5_PARTICLE_VFX_IDS = [
  "magic-sparkle-burst",
  "soft-heart-pop",
  "surprise-shock-pop",
  "confusion-orbit-marks",
  "sleep-bubbles",
  "sad-rain-puff",
] as const;

const TEST_PARTICLE_MEDIA_PROVIDER = {
  ...EMPTY_RUNTIME_MEDIA_PROVIDER,
  listParticleVFX: () => AVATAR_PARTICLE_VFX_CATALOG,
  getParticlePreloadIds: (tier: "tierA" | "tierB" | "none") =>
    AVATAR_PARTICLE_VFX_CATALOG.filter(
      (entry) => entry.preloadTier === tier,
    ).map((entry) => entry.id),
  resolveParticleVFX: async (runtimeId: string) =>
    AVATAR_PARTICLE_VFX_CATALOG.find((entry) => entry.id === runtimeId) ?? null,
};

type CatalogQuarksJson = {
  images?: Array<{ url?: string }>;
  materials?: Array<{ uuid?: string; blending?: number }>;
  object?: {
    children?: Array<{
      name?: string;
      ps?: {
        looping?: boolean;
        prewarm?: boolean;
        renderMode?: number;
        rendererEmitterSettings?: Record<string, unknown>;
        uTileCount?: number;
        vTileCount?: number;
        behaviors?: Array<{ type?: string }>;
      };
    }>;
  };
};

type MockParticleSystem = {
  worldSpace: boolean;
  autoDestroy: boolean;
  emitterShape: {
    type: string;
    width?: number;
    height?: number;
  };
  emitter: MockParticleEmitter | null;
  _renderer: { deleteSystem: (system: MockParticleSystem) => void } | null;
  clone: () => MockParticleSystem;
  dispose: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type MockLoadQueueItem =
  | { kind: "resolve"; object: Object3D }
  | { kind: "reject"; error: unknown };

type MockBatch = Object3D & {
  dispose: ReturnType<typeof vi.fn>;
  material: MeshBasicMaterial;
};

type MockBatchRenderer = Object3D & {
  systems: Set<MockParticleSystem>;
  batches: MockBatch[];
  addSystem: (system: MockParticleSystem) => void;
  deleteSystem: (system: MockParticleSystem) => void;
  update: ReturnType<typeof vi.fn>;
};

const quarksMockState = vi.hoisted(() => ({
  createdSystems: [] as MockParticleSystem[],
  lastBatchRenderer: null as MockBatchRenderer | null,
  loadAttempts: 0,
  loadAssetPaths: [] as string[],
  loadQueue: [] as MockLoadQueueItem[],
  playThrows: false,
}));

vi.mock("three.quarks", async () => {
  const THREE = await vi.importActual<typeof import("three")>("three");

  class BatchedRenderer extends THREE.Object3D implements MockBatchRenderer {
    systems = new Set<MockParticleSystem>();
    batches: MockBatch[] = [];
    update = vi.fn();

    constructor() {
      super();
      quarksMockState.lastBatchRenderer = this;
    }

    addSystem(system: MockParticleSystem) {
      system._renderer = this;
      this.systems.add(system);
      if (this.batches.length === 0) {
        const batch = new THREE.Object3D() as MockBatch;
        batch.dispose = vi.fn();
        batch.material = new THREE.MeshBasicMaterial();
        this.batches.push(batch);
        this.add(batch);
      }
    }

    deleteSystem(system: MockParticleSystem) {
      this.systems.delete(system);
      system._renderer = null;
    }
  }

  class QuarksLoader {
    load(
      assetPath: string,
      onLoad: (object: Object3D) => void,
      _onProgress?: unknown,
      onError?: (error: unknown) => void,
    ) {
      quarksMockState.loadAttempts += 1;
      quarksMockState.loadAssetPaths.push(assetPath);
      const item = quarksMockState.loadQueue.shift();
      if (!item) {
        onError?.(new Error("No mock particle VFX load queued."));
        return;
      }
      if (item.kind === "reject") {
        onError?.(item.error);
        return;
      }
      onLoad(item.object);
    }
  }

  const QuarksUtil = {
    runOnAllParticleEmitters(
      object: Object3D,
      callback: (emitter: MockParticleEmitter) => void,
    ) {
      object.traverse((child) => {
        if (child.type === "ParticleEmitter") {
          callback(child as MockParticleEmitter);
        }
      });
    },
    addToBatchRenderer(object: Object3D, batchRenderer: MockBatchRenderer) {
      QuarksUtil.runOnAllParticleEmitters(object, (emitter) => {
        batchRenderer.addSystem(emitter.system);
      });
    },
    setAutoDestroy(object: Object3D, value: boolean) {
      QuarksUtil.runOnAllParticleEmitters(object, (emitter) => {
        emitter.system.autoDestroy = value;
      });
    },
    play(object: Object3D) {
      if (quarksMockState.playThrows) {
        throw new Error("mock play failed");
      }
      QuarksUtil.runOnAllParticleEmitters(object, (emitter) => {
        emitter.system.play();
      });
    },
    stop(object: Object3D) {
      QuarksUtil.runOnAllParticleEmitters(object, (emitter) => {
        emitter.system.stop();
      });
    },
  };

  return { BatchedRenderer, QuarksLoader, QuarksUtil };
});

class MockParticleEmitter extends Object3D {
  override type = "ParticleEmitter";
  system: MockParticleSystem;

  constructor(system: MockParticleSystem) {
    super();
    this.system = system;
    system.emitter = this;
  }

  override clone(): this {
    const emitter = new MockParticleEmitter(this.system.clone());
    emitter.copy(this, false);
    return emitter as this;
  }
}

function createMockAvatar(
  bones: Record<string, Vector3>,
): Pick<Avatar, "scene" | "vrm"> {
  const scene = new Group();
  const boneNodes = new Map<string, Object3D>();

  for (const [boneName, position] of Object.entries(bones)) {
    const node = new Object3D();
    node.position.copy(position);
    scene.add(node);
    boneNodes.set(boneName, node);
  }
  scene.updateMatrixWorld(true);

  return {
    scene,
    vrm: {
      humanoid: {
        getNormalizedBoneNode: (boneName: string) =>
          boneNodes.get(boneName) ?? null,
      },
    } as never,
  } as Pick<Avatar, "scene" | "vrm">;
}

function createMockParticleSystem(
  worldSpace: boolean,
  emitterShape: MockParticleSystem["emitterShape"] = { type: "sphere" },
): MockParticleSystem {
  const system: MockParticleSystem = {
    worldSpace,
    autoDestroy: true,
    emitterShape: { ...emitterShape },
    emitter: null,
    _renderer: null,
    clone: () => {
      const cloned = createMockParticleSystem(worldSpace, system.emitterShape);
      quarksMockState.createdSystems.push(cloned);
      return cloned;
    },
    dispose: vi.fn(() => {
      system._renderer?.deleteSystem(system);
      system.emitter?.parent?.remove(system.emitter);
    }),
    play: vi.fn(),
    stop: vi.fn(),
  };
  return system;
}

function createMockQuarksPrefab(
  options: {
    worldSpace?: boolean;
    emitterShape?: MockParticleSystem["emitterShape"];
    emitterName?: string;
  } = {},
): Object3D {
  const prefab = new Group();
  const system = createMockParticleSystem(
    options.worldSpace ?? false,
    options.emitterShape,
  );
  const emitter = new MockParticleEmitter(system);
  if (options.emitterName) emitter.name = options.emitterName;
  prefab.add(emitter);
  return prefab;
}

function resetQuarksMockState() {
  quarksMockState.createdSystems = [];
  quarksMockState.lastBatchRenderer = null;
  quarksMockState.loadAttempts = 0;
  quarksMockState.loadAssetPaths = [];
  quarksMockState.loadQueue = [];
  quarksMockState.playThrows = false;
  vi.clearAllMocks();
}

const INCLUDED_PARTICLE_VFX_ROOT = new URL(
  "../../../../../content/included/vfx/particle/",
  import.meta.url,
);

function includedParticleVfxFile(publicPath: string): URL {
  const aliases = [
    ["/effects/vfx/quark/", "quark/"],
    ["/effects/vfx/particle-vfx/", "particle-vfx/"],
  ] as const;
  for (const [routePrefix, includedPrefix] of aliases) {
    if (publicPath.startsWith(routePrefix)) {
      return new URL(
        `${includedPrefix}${publicPath.slice(routePrefix.length)}`,
        INCLUDED_PARTICLE_VFX_ROOT,
      );
    }
  }
  throw new Error(`Unmapped Included particle VFX URL: ${publicPath}`);
}

function readCatalogQuarksJson(effectId: string): CatalogQuarksJson {
  const entry = getParticleVFXCatalogEntryById(effectId);
  expect(entry).toBeTruthy();
  const jsonPath = includedParticleVfxFile(entry?.assetPath ?? "");
  return JSON.parse(readFileSync(jsonPath, "utf8")) as CatalogQuarksJson;
}

function collectCatalogQuarksImageUrls(json: CatalogQuarksJson): Set<string> {
  return new Set((json.images ?? []).map((image) => image.url ?? ""));
}

function collectCatalogQuarksBehaviorTypes(
  json: CatalogQuarksJson,
): Set<string> {
  return new Set(
    (json.object?.children ?? []).flatMap((emitter) =>
      (emitter.ps?.behaviors ?? []).map((behavior) => behavior.type ?? ""),
    ),
  );
}

beforeEach(() => {
  resetQuarksMockState();
});

describe("particle VFX catalog", () => {
  it("has the expected catalog ids and resolves cartoon-bang", () => {
    const ids = AVATAR_PARTICLE_VFX_CATALOG.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "cartoon-bang",
      "hearts",
      "stars",
      "sparkles",
      "question-marks",
      "exclamation",
      "zzz",
      "rain-cloud",
      "hearts-v1",
      "exclamation-v1",
      "question-v1",
      "hearts-v2",
      "star-v2",
      "flame-loop",
      ...PHASE_5_PARTICLE_VFX_IDS,
    ]);
    expect(getParticleVFXCatalogEntryById("cartoon-bang")).toMatchObject({
      id: "cartoon-bang",
      defaultAnchor: "head",
    });
    expect(getParticleVFXCatalogEntryById("flame-loop")).toMatchObject({
      id: "flame-loop",
      defaultAnchor: "chest",
      preloadTier: "none",
      performanceBudget: {
        loopingAllowed: true,
        canCoexist: false,
      },
    });
  });

  it("uses root-relative public asset paths", () => {
    for (const entry of AVATAR_PARTICLE_VFX_CATALOG) {
      expect(entry.assetPath).toMatch(/^\/.+/);
      expect(entry.assetPath.trim()).toBe(entry.assetPath);
      expect(entry.assetPath).not.toContain("brackeys_vfx_bundle");
      expect(entry.assetPath).not.toContain("kenney_particle-pack");
      expect(entry.assetPath).not.toContain("LeLu");
    }
  });

  it("points every catalog entry at an existing public quarks JSON asset", () => {
    for (const entry of AVATAR_PARTICLE_VFX_CATALOG) {
      const jsonPath = includedParticleVfxFile(entry.assetPath);
      expect(existsSync(jsonPath), entry.assetPath).toBe(true);
    }
  });

  it("declares preload tiers and conservative performance budgets", () => {
    const loopingAllowedIds = new Set([
      "hearts-v1",
      "exclamation-v1",
      "question-v1",
      "hearts-v2",
      "star-v2",
      "flame-loop",
    ]);

    for (const entry of AVATAR_PARTICLE_VFX_CATALOG) {
      expect(["tierA", "none"]).toContain(entry.preloadTier);
      expect(entry.performanceBudget.maxDurationSec).toBeGreaterThanOrEqual(
        entry.defaultDurationSec,
      );
      expect(entry.performanceBudget.maxParticles).toBeGreaterThan(0);
      expect(entry.performanceBudget.loopingAllowed).toBe(
        loopingAllowedIds.has(entry.id),
      );
      expect(typeof entry.performanceBudget.canCoexist).toBe("boolean");
    }

    expect(getParticleVFXCatalogEntryById("cartoon-bang")?.preloadTier).toBe(
      "none",
    );
    expect(getParticleVFXCatalogEntryById("hearts")?.preloadTier).toBe("tierA");
  });

  it("declares conservative metadata for Phase 5 catalog effects", () => {
    const expected = {
      "magic-sparkle-burst": {
        defaultAnchor: "chest",
        defaultDurationSec: 1.8,
        maxDurationSec: 2.4,
        maxParticles: 52,
        canCoexist: true,
      },
      "soft-heart-pop": {
        defaultAnchor: "head",
        defaultDurationSec: 1.9,
        maxDurationSec: 2.4,
        maxParticles: 36,
        canCoexist: true,
      },
      "surprise-shock-pop": {
        defaultAnchor: "head",
        defaultDurationSec: 1.25,
        maxDurationSec: 1.8,
        maxParticles: 40,
        canCoexist: false,
      },
      "confusion-orbit-marks": {
        defaultAnchor: "head",
        defaultDurationSec: 2.3,
        maxDurationSec: 2.8,
        maxParticles: 32,
        canCoexist: false,
      },
      "sleep-bubbles": {
        defaultAnchor: "head",
        defaultDurationSec: 2.8,
        maxDurationSec: 3.2,
        maxParticles: 28,
        canCoexist: false,
      },
      "sad-rain-puff": {
        defaultAnchor: "head",
        defaultDurationSec: 2.5,
        maxDurationSec: 3,
        maxParticles: 42,
        canCoexist: false,
      },
    } satisfies Record<
      (typeof PHASE_5_PARTICLE_VFX_IDS)[number],
      {
        defaultAnchor: string;
        defaultDurationSec: number;
        maxDurationSec: number;
        maxParticles: number;
        canCoexist: boolean;
      }
    >;

    for (const id of PHASE_5_PARTICLE_VFX_IDS) {
      const entry = getParticleVFXCatalogEntryById(id);
      expect(entry).toMatchObject({
        id,
        defaultAnchor: expected[id].defaultAnchor,
        defaultDurationSec: expected[id].defaultDurationSec,
        preloadTier: "none",
        performanceBudget: {
          maxDurationSec: expected[id].maxDurationSec,
          maxParticles: expected[id].maxParticles,
          loopingAllowed: false,
          canCoexist: expected[id].canCoexist,
        },
      });
    }
  });

  it("uses runtime-safe relative texture urls in catalog quarks JSON", () => {
    for (const entry of AVATAR_PARTICLE_VFX_CATALOG) {
      const jsonPath = includedParticleVfxFile(entry.assetPath);
      const json = JSON.parse(readFileSync(jsonPath, "utf8")) as {
        images?: Array<{ url?: string }>;
      };

      expect(json.images?.length).toBeGreaterThan(0);
      for (const image of json.images ?? []) {
        expect(typeof image.url).toBe("string");
        expect(classifyParticleVFXTextureUrl(image.url ?? "")).toBe("relative");
        expect(image.url).toMatch(/^textures\/[\w.-]+$/);
        const texturePath = new URL(image.url ?? "", jsonPath);
        expect(existsSync(texturePath), image.url).toBe(true);
        expect(texturePath.pathname).toContain(
          "/content/included/vfx/particle/quark/",
        );
        expect(texturePath.pathname).toContain("/textures/");
        expect(image.url).not.toContain("brackeys_vfx_bundle");
        expect(image.url).not.toContain("kenney_particle-pack");
        expect(image.url).not.toContain("LeLu");
      }
    }
  });

  it("generates Phase 5 effects as layered authored emitters", () => {
    for (const id of PHASE_5_PARTICLE_VFX_IDS) {
      const json = readCatalogQuarksJson(id);
      const emitters = json.object?.children ?? [];
      expect(emitters.length, id).toBeGreaterThanOrEqual(2);
      expect(
        emitters.every((emitter) => emitter.ps?.looping === false),
        id,
      ).toBe(true);
      expect(
        collectCatalogQuarksImageUrls(json).size,
        id,
      ).toBeGreaterThanOrEqual(3);
    }

    const magic = readCatalogQuarksJson("magic-sparkle-burst");
    expect(collectCatalogQuarksImageUrls(magic)).toEqual(
      new Set([
        "textures/brackeys-flare.png",
        "textures/magic-ring.png",
        "textures/spark-pop-6x5.png",
        "textures/spark-streak.png",
        "textures/sparkle.png",
      ]),
    );
    expect(collectCatalogQuarksBehaviorTypes(magic)).toContain("FrameOverLife");
    expect(
      magic.object?.children?.some(
        (emitter) =>
          emitter.ps?.uTileCount === 6 && emitter.ps?.vTileCount === 5,
      ),
    ).toBe(true);
    expect(
      magic.object?.children?.some((emitter) => emitter.ps?.renderMode === 1),
    ).toBe(true);

    expect(
      collectCatalogQuarksImageUrls(readCatalogQuarksJson("soft-heart-pop")),
    ).toEqual(
      new Set([
        "textures/glow-soft.png",
        "textures/heart-v2.png",
        "textures/heart.png",
        "textures/spark-dot.png",
      ]),
    );

    expect(
      collectCatalogQuarksImageUrls(
        readCatalogQuarksJson("surprise-shock-pop"),
      ),
    ).toEqual(
      new Set([
        "textures/brackeys-flare.png",
        "textures/exclamation.png",
        "textures/shock-ring.png",
        "textures/spark-streak.png",
      ]),
    );

    const confusion = readCatalogQuarksJson("confusion-orbit-marks");
    expect(collectCatalogQuarksImageUrls(confusion)).toEqual(
      new Set([
        "textures/glow-soft.png",
        "textures/question.png",
        "textures/spark-dot.png",
      ]),
    );
    expect(collectCatalogQuarksBehaviorTypes(confusion)).toContain(
      "OrbitOverLife",
    );

    expect(
      collectCatalogQuarksImageUrls(readCatalogQuarksJson("sleep-bubbles")),
    ).toEqual(
      new Set([
        "textures/soft-dot.png",
        "textures/spark-dot.png",
        "textures/zzz.png",
      ]),
    );

    expect(
      collectCatalogQuarksImageUrls(readCatalogQuarksJson("sad-rain-puff")),
    ).toEqual(
      new Set([
        "textures/cloud.png",
        "textures/dust-soft.png",
        "textures/raindrop.png",
        "textures/smoke-puff.png",
      ]),
    );
  });

  it("generates the persistent flame as layered looping emitters", () => {
    const flame = getParticleVFXCatalogEntryById("flame-loop");
    expect(flame).toBeTruthy();
    const jsonPath = includedParticleVfxFile(flame?.assetPath ?? "");
    const json = JSON.parse(readFileSync(jsonPath, "utf8")) as {
      images?: Array<{ url?: string }>;
      materials?: Array<{ uuid?: string; blending?: number }>;
      object?: {
        children?: Array<{
          name?: string;
          ps?: {
            looping?: boolean;
            prewarm?: boolean;
            renderMode?: number;
            rendererEmitterSettings?: Record<string, unknown>;
          };
        }>;
      };
    };
    const imageUrls = new Set((json.images ?? []).map((image) => image.url));
    expect(imageUrls).toEqual(
      new Set([
        "textures/kenney-ember-spark.png",
        "textures/kenney-fire-glow.png",
        "textures/kenney-flame-core.png",
        "textures/kenney-flame-tongue.png",
        "textures/kenney-smoke-wisp.png",
      ]),
    );
    const emitters = json.object?.children ?? [];
    expect(emitters.map((emitter) => emitter.name)).toEqual([
      "flame-base-glow",
      "flame-inner-core",
      "flame-outer-tongues",
      "flame-embers",
      "flame-smoke-wisps",
    ]);
    expect(emitters.every((emitter) => emitter.ps?.looping === true)).toBe(
      true,
    );
    expect(emitters.every((emitter) => emitter.ps?.prewarm === true)).toBe(
      true,
    );
    expect(emitters.some((emitter) => emitter.ps?.renderMode === 1)).toBe(true);
    expect(
      emitters.some(
        (emitter) =>
          typeof emitter.ps?.rendererEmitterSettings?.speedFactor === "number",
      ),
    ).toBe(true);
    expect(json.materials?.some((material) => material.blending === 1)).toBe(
      true,
    );
  });
});

describe("particle VFX avatar-bounds auto-fit helpers", () => {
  it("computes local avatar bounds while skipping particle VFX roots", () => {
    const avatar = createMockAvatar({}) as Avatar;
    const avatarMesh = new Mesh(
      new BoxGeometry(0.4, 1.2, 0.2),
      new MeshBasicMaterial(),
    );
    avatarMesh.position.set(0.2, 0.6, 0.1);
    avatar.scene?.add(avatarMesh);

    const particleRoot = new Group();
    particleRoot.name = PARTICLE_VFX_ROOT_OBJECT_NAME;
    particleRoot.add(
      new Mesh(new BoxGeometry(99, 99, 99), new MeshBasicMaterial()),
    );
    avatar.scene?.add(particleRoot);

    const result = resolveParticleVFXAvatarBoundsRectangleFit({
      avatar,
      transform: normalizeParticleVFXTransform({
        offset: { x: 0.1, y: 0.2, z: 0.3 },
        depthOffset: 0.4,
        scale: { x: 2, y: 1, z: 1 },
      }),
      shapeAutoFit: {
        kind: "avatarBoundsRectangle",
        padding: { width: 0.2, height: 0.1 },
        minSize: { width: 0.1, height: 0.1 },
      },
    });

    expect(result.warning).toBeNull();
    expect(result.fit?.bounds.center.x).toBeCloseTo(0.2);
    expect(result.fit?.bounds.center.y).toBeCloseTo(0.6);
    expect(result.fit?.bounds.size.x).toBeCloseTo(0.4);
    expect(result.fit?.bounds.size.y).toBeCloseTo(1.2);
    expect(result.fit?.width).toBeCloseTo(0.3);
    expect(result.fit?.height).toBeCloseTo(1.3);
    expect(result.fit?.position.x).toBeCloseTo(0.3);
    expect(result.fit?.position.y).toBeCloseTo(0.8);
    expect(result.fit?.position.z).toBeCloseTo(0.8);
  });

  it("patches only matching rectangle emitter shapes", () => {
    const object = new Group();
    const rectangleSystem = createMockParticleSystem(false, {
      type: "rectangle",
      width: 1,
      height: 1,
    });
    const rectangleEmitter = new MockParticleEmitter(rectangleSystem);
    rectangleEmitter.name = "target";
    const otherRectangleSystem = createMockParticleSystem(false, {
      type: "rectangle",
      width: 1,
      height: 1,
    });
    const otherRectangleEmitter = new MockParticleEmitter(otherRectangleSystem);
    otherRectangleEmitter.name = "other";
    const sphereSystem = createMockParticleSystem(false, { type: "sphere" });
    const sphereEmitter = new MockParticleEmitter(sphereSystem);
    sphereEmitter.name = "target";
    object.add(rectangleEmitter, otherRectangleEmitter, sphereEmitter);

    const patchedCount = applyParticleVFXRectangleShapeAutoFit({
      object,
      shapeAutoFit: {
        kind: "avatarBoundsRectangle",
        emitterNames: ["target"],
      },
      width: 0.8,
      height: 1.9,
    });

    expect(patchedCount).toBe(1);
    expect(rectangleSystem.emitterShape).toMatchObject({
      width: 0.8,
      height: 1.9,
    });
    expect(otherRectangleSystem.emitterShape).toMatchObject({
      width: 1,
      height: 1,
    });
    expect(sphereSystem.emitterShape).toEqual({ type: "sphere" });
  });
});

describe("ParticleVFXController", () => {
  it("auto-fits rectangle emitters from avatar rendered bounds at play time", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const avatarMesh = new Mesh(
      new BoxGeometry(0.5, 1.8, 0.2),
      new MeshBasicMaterial(),
    );
    avatarMesh.position.set(0.1, 0.9, 0);
    avatar.scene?.add(avatarMesh);
    avatar.scene?.updateMatrixWorld(true);

    const effect = getParticleVFXCatalogEntryById(
      "hearts",
    ) as ParticleVFXCatalogEntry;
    const previousShapeAutoFit = effect.shapeAutoFit;
    effect.shapeAutoFit = {
      kind: "avatarBoundsRectangle",
      padding: { width: 0.2, height: 0.1 },
      minSize: { width: 0.1, height: 0.1 },
    };

    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab({
        emitterShape: { type: "rectangle", width: 1, height: 1 },
      }),
    });

    try {
      await expect(
        controller.playEffect({
          effectId: "hearts",
          appliedId: "auto-fit-hearts",
        }),
      ).resolves.toBe(true);

      expect(quarksMockState.createdSystems[0]?.emitterShape.type).toBe(
        "rectangle",
      );
      expect(quarksMockState.createdSystems[0]?.emitterShape.width).toBeCloseTo(
        0.7,
      );
      expect(
        quarksMockState.createdSystems[0]?.emitterShape.height,
      ).toBeCloseTo(1.9);
      const root = avatar.scene?.getObjectByName(PARTICLE_VFX_ROOT_OBJECT_NAME);
      const object = root?.children.find((child) =>
        child.name.startsWith("ParticleVFX:hearts:auto-fit-hearts"),
      );
      expect(object?.position.x).toBeCloseTo(0.1);
      expect(object?.position.y).toBeCloseTo(1.22);
      expect(object?.position.z).toBeCloseTo(0.12);
      expect(controller.getSnapshot().activeInstances[0]?.followAnchor).toBe(
        false,
      );
    } finally {
      effect.shapeAutoFit = previousShapeAutoFit;
      controller.dispose();
    }
  });

  it("falls back to anchor placement when auto-fit finds no rectangle emitters", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    avatar.scene?.add(
      new Mesh(new BoxGeometry(0.5, 1.8, 0.2), new MeshBasicMaterial()),
    );

    const effect = getParticleVFXCatalogEntryById(
      "hearts",
    ) as ParticleVFXCatalogEntry;
    const previousShapeAutoFit = effect.shapeAutoFit;
    effect.shapeAutoFit = {
      kind: "avatarBoundsRectangle",
      minSize: { width: 0.1, height: 0.1 },
    };

    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab({
        emitterShape: { type: "sphere" },
      }),
    });

    try {
      await expect(
        controller.playEffect({
          effectId: "hearts",
          appliedId: "fallback-hearts",
        }),
      ).resolves.toBe(true);

      const root = avatar.scene?.getObjectByName(PARTICLE_VFX_ROOT_OBJECT_NAME);
      const object = root?.children.find((child) =>
        child.name.startsWith("ParticleVFX:hearts:fallback-hearts"),
      );
      expect(object?.position.y).toBeCloseTo(1.82);
      expect(controller.getSnapshot().activeInstances[0]?.followAnchor).toBe(
        true,
      );
      expect(controller.getSnapshot().warnings.join("\n")).toContain(
        "no matching rectangle emitters",
      );
    } finally {
      effect.shapeAutoFit = previousShapeAutoFit;
      controller.dispose();
    }
  });

  it("preloads an effect without creating an active instance", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(controller.preloadEffect("hearts")).resolves.toBe(true);

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeCount).toBe(0);
    expect(snapshot.loadedEffectIds).toContain("hearts");
    expect(quarksMockState.loadAssetPaths).toEqual([
      "/effects/vfx/quark/hearts/particle.json",
    ]);
    controller.dispose();
  });

  it("retries preloading after a previous load failure", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "reject",
      error: new Error("temporary preload error"),
    });

    await expect(controller.preloadEffect("stars")).resolves.toBe(false);
    expect(quarksMockState.loadAttempts).toBe(1);

    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(controller.preloadEffect("stars")).resolves.toBe(true);
    expect(quarksMockState.loadAttempts).toBe(2);
    expect(controller.getSnapshot().loadedEffectIds).toContain("stars");
    controller.dispose();
  });

  it("preloads tier-A catalog entries with a bounded result", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    const tierAEntries = AVATAR_PARTICLE_VFX_CATALOG.filter(
      (entry) => entry.preloadTier === "tierA",
    );
    for (let index = 0; index < tierAEntries.length; index += 1) {
      quarksMockState.loadQueue.push({
        kind: "resolve",
        object: createMockQuarksPrefab(),
      });
    }

    await expect(
      controller.preloadCatalogTier("tierA", { concurrency: 2 }),
    ).resolves.toEqual({
      requestedCount: tierAEntries.length,
      loadedCount: tierAEntries.length,
      failedCount: 0,
    });
    expect(controller.getSnapshot().activeCount).toBe(0);
    expect(controller.getSnapshot().loadedEffectIds).toEqual(
      tierAEntries.map((entry) => entry.id).sort(),
    );
    expect(quarksMockState.loadAssetPaths).not.toContain(
      "/effects/vfx/quark/Cartoon Bang.json",
    );
    controller.dispose();
  });

  it("counts slow pending effects against the four-instance limit", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    let resolvePrefab: ((object: Object3D) => void) | null = null;
    const pendingPrefab = new Promise<Object3D>((resolve) => {
      resolvePrefab = resolve;
    });
    (
      controller as unknown as {
        _loadPrefab: () => Promise<Object3D>;
      }
    )._loadPrefab = vi.fn(() => pendingPrefab);

    const requests = Array.from({ length: 5 }, (_, index) =>
      controller.playEffect({
        effectId: "hearts",
        appliedId: `pending-${index}`,
      }),
    );

    await expect(requests[4]).resolves.toBe(false);
    expect(controller.getSnapshot().warnings.join("\n")).toContain(
      "concurrency limit",
    );

    controller.clearAll();
    resolvePrefab?.(createMockQuarksPrefab());
    await expect(Promise.all(requests.slice(0, 4))).resolves.toEqual([
      false,
      false,
      false,
      false,
    ]);
    controller.dispose();
  });

  it("counts slow pending effects against the total particle budget", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const baseEffect = AVATAR_PARTICLE_VFX_CATALOG.find(
      (entry) => entry.id === "hearts",
    );
    if (!baseEffect) throw new Error("Missing hearts particle fixture.");
    const provider = {
      ...EMPTY_RUNTIME_MEDIA_PROVIDER,
      resolveParticleVFX: async () => ({
        ...baseEffect,
        performanceBudget: {
          ...baseEffect.performanceBudget,
          maxParticles: 200,
        },
      }),
    };
    const controller = new ParticleVFXController(avatar, provider);
    let resolvePrefab: ((object: Object3D) => void) | null = null;
    const pendingPrefab = new Promise<Object3D>((resolve) => {
      resolvePrefab = resolve;
    });
    (
      controller as unknown as {
        _loadPrefab: () => Promise<Object3D>;
      }
    )._loadPrefab = vi.fn(() => pendingPrefab);

    const first = controller.playEffect({
      effectId: "hearts",
      appliedId: "budget-1",
    });
    const second = controller.playEffect({
      effectId: "hearts",
      appliedId: "budget-2",
    });
    await expect(
      controller.playEffect({
        effectId: "hearts",
        appliedId: "budget-3",
      }),
    ).resolves.toBe(false);
    expect(controller.getSnapshot().warnings.join("\n")).toContain(
      "active-particle budget",
    );

    controller.clearAll();
    resolvePrefab?.(createMockQuarksPrefab());
    await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
    controller.dispose();
  });

  it("cleans up a partially attached effect when quarks play fails", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });
    quarksMockState.playThrows = true;

    const didApply = await controller.playEffect({
      effectId: "cartoon-bang",
      appliedId: "failed-bang",
    });

    expect(didApply).toBe(false);
    expect(controller.getSnapshot().activeCount).toBe(0);
    expect(quarksMockState.lastBatchRenderer?.systems.size).toBe(0);
    expect(quarksMockState.createdSystems[0]?.dispose).toHaveBeenCalled();

    const root = avatar.scene?.getObjectByName("AnimamaParticleVFXRoot");
    expect(
      root?.children.some((child) => child.name.startsWith("ParticleVFX:")),
    ).toBe(false);
    controller.dispose();
  });

  it("retries a prefab load after a previous load failure", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "reject",
      error: new Error("temporary network error"),
    });

    await expect(
      controller.playEffect({
        effectId: "cartoon-bang",
        appliedId: "retry-bang",
      }),
    ).resolves.toBe(false);
    expect(quarksMockState.loadAttempts).toBe(1);

    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "cartoon-bang",
        appliedId: "retry-bang",
      }),
    ).resolves.toBe(true);
    expect(quarksMockState.loadAttempts).toBe(2);
    expect(controller.getSnapshot().activeCount).toBe(1);
    controller.dispose();
  });

  it("reports world-space effects and disables continuous anchor follow", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab({ worldSpace: true }),
    });

    await expect(
      controller.playEffect({
        effectId: "cartoon-bang",
        appliedId: "world-space-bang",
      }),
    ).resolves.toBe(true);

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeInstances[0]).toMatchObject({
      appliedId: "world-space-bang",
      followAnchor: false,
      usesWorldSpace: true,
    });
    expect(snapshot.warnings.join("\n")).toContain("world-space emitters");
    controller.dispose();
  });

  it("disposes quarks batches when the controller is disposed", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "cartoon-bang",
        appliedId: "disposable-bang",
      }),
    ).resolves.toBe(true);
    const batch = quarksMockState.lastBatchRenderer?.batches[0];

    controller.dispose();

    expect(batch?.dispose).toHaveBeenCalled();
    expect(
      avatar.scene?.getObjectByName("AnimamaParticleVFXRoot"),
    ).toBeUndefined();
  });

  it("caps requested duration by catalog performance budget", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    const hearts = getParticleVFXCatalogEntryById("hearts");
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "hearts",
        appliedId: "long-hearts",
        durationSec: 99,
      }),
    ).resolves.toBe(true);

    const snapshot = controller.getSnapshot();
    expect(snapshot.activeInstances[0]?.durationSec).toBe(
      hearts?.performanceBudget.maxDurationSec,
    );
    expect(snapshot.warnings.join("\n")).toContain("duration was capped");
    controller.dispose();
  });

  it("keeps manual lifetime instances active until the applied id is cleared", async () => {
    const avatar = createMockAvatar({
      chest: new Vector3(0, 1.1, 0),
    }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "flame-loop",
        appliedId: "manual-flame",
        lifetime: { kind: "manual" },
      }),
    ).resolves.toBe(true);

    controller.update(20);
    controller.update(20);

    let snapshot = controller.getSnapshot();
    expect(snapshot.activeCount).toBe(1);
    expect(snapshot.activeInstances[0]).toMatchObject({
      appliedId: "manual-flame",
      effectId: "flame-loop",
      lifetime: { kind: "manual" },
      durationSec: null,
    });
    expect(quarksMockState.lastBatchRenderer?.update).toHaveBeenCalledTimes(2);

    expect(controller.clearEffect("manual-flame")).toBe(true);
    snapshot = controller.getSnapshot();
    expect(snapshot.activeCount).toBe(0);
    expect(quarksMockState.lastBatchRenderer?.systems.size).toBe(0);
    expect(quarksMockState.createdSystems[0]?.dispose).toHaveBeenCalled();
    controller.dispose();
  });

  it("removes manual lifetime instances through clearAll and dispose", async () => {
    const avatar = createMockAvatar({
      chest: new Vector3(0, 1.1, 0),
    }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "flame-loop",
        appliedId: "manual-flame-clear-all",
        lifetime: { kind: "manual" },
      }),
    ).resolves.toBe(true);

    controller.clearAll();
    expect(controller.getSnapshot().activeCount).toBe(0);
    expect(quarksMockState.lastBatchRenderer?.systems.size).toBe(0);

    await expect(
      controller.playEffect({
        effectId: "flame-loop",
        appliedId: "manual-flame-dispose",
        lifetime: { kind: "manual" },
      }),
    ).resolves.toBe(true);

    controller.dispose();
    expect(
      avatar.scene?.getObjectByName("AnimamaParticleVFXRoot"),
    ).toBeUndefined();
    expect(quarksMockState.lastBatchRenderer?.systems.size).toBe(0);
  });

  it("rejects manual lifetime for non-looping catalog entries", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );

    await expect(
      controller.playEffect({
        effectId: "hearts",
        appliedId: "manual-hearts",
        lifetime: { kind: "manual" },
      }),
    ).resolves.toBe(false);

    expect(controller.getSnapshot().activeCount).toBe(0);
    expect(controller.getSnapshot().warnings.join("\n")).toContain(
      "does not allow looping",
    );
    expect(quarksMockState.loadAttempts).toBe(0);
    controller.dispose();
  });

  it("still expires duration-backed particle instances by elapsed time", async () => {
    const avatar = createMockAvatar({ head: new Vector3(0, 1.5, 0) }) as Avatar;
    const controller = new ParticleVFXController(
      avatar,
      TEST_PARTICLE_MEDIA_PROVIDER,
    );
    quarksMockState.loadQueue.push({
      kind: "resolve",
      object: createMockQuarksPrefab(),
    });

    await expect(
      controller.playEffect({
        effectId: "hearts",
        appliedId: "short-hearts",
        lifetime: { kind: "duration", durationSec: 0.2 },
      }),
    ).resolves.toBe(true);

    controller.update(0.1);
    expect(controller.getSnapshot().activeCount).toBe(1);
    controller.update(0.11);
    expect(controller.getSnapshot().activeCount).toBe(0);
    expect(quarksMockState.lastBatchRenderer?.systems.size).toBe(0);
    expect(quarksMockState.createdSystems[0]?.dispose).toHaveBeenCalled();
    controller.dispose();
  });
});

describe("particle VFX transforms", () => {
  it("normalizes default transform values", () => {
    expect(normalizeParticleVFXTransform(null)).toEqual({
      offset: { x: 0, y: 0, z: 0 },
      depthOffset: 0,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    });
  });

  it("combines local z offset and depth offset for front/back placement", () => {
    const transform = normalizeParticleVFXTransform({
      offset: { x: 0.1, y: 0.2, z: 0.3 },
      depthOffset: -0.4,
    });

    const combinedOffset = getParticleVFXCombinedOffset(transform);
    expect(combinedOffset.x).toBeCloseTo(0.1);
    expect(combinedOffset.y).toBeCloseTo(0.2);
    expect(combinedOffset.z).toBeCloseTo(-0.1);
  });
});

describe("particle VFX anchor resolution", () => {
  it("resolves a direct head anchor", () => {
    const avatar = createMockAvatar({
      head: new Vector3(0, 1.5, 0),
    }) as Avatar;

    const result = resolveParticleVFXAnchorLocalPosition({
      avatar,
      anchor: "head",
      transform: normalizeParticleVFXTransform({
        offset: { y: 0.2 },
        depthOffset: 0.1,
      }),
    });

    expect(result).toMatchObject({
      requestedAnchor: "head",
      resolvedAnchor: "head",
      boneName: "head",
      position: { x: 0, y: 1.7, z: 0.1 },
      warning: null,
    });
  });

  it("falls back from chest to upperChest", () => {
    const avatar = createMockAvatar({
      upperChest: new Vector3(0.1, 1.2, 0.2),
    }) as Avatar;

    const result = resolveParticleVFXAnchorLocalPosition({
      avatar,
      anchor: "chest",
      transform: normalizeParticleVFXTransform(null),
    });

    expect(result).toMatchObject({
      requestedAnchor: "chest",
      resolvedAnchor: "chest",
      boneName: "upperChest",
      position: { x: 0.1, y: 1.2, z: 0.2 },
    });
    expect(result?.warning).toContain("fell back");
  });

  it("falls back to root when no candidate bone resolves", () => {
    const avatar = createMockAvatar({}) as Avatar;

    const result = resolveParticleVFXAnchorLocalPosition({
      avatar,
      anchor: "leftHand",
      transform: normalizeParticleVFXTransform({
        offset: { x: 0.2, y: 0.3, z: 0.4 },
        depthOffset: 0.5,
      }),
    });

    expect(result).toMatchObject({
      requestedAnchor: "leftHand",
      resolvedAnchor: "root",
      boneName: null,
      position: { x: 0.2, y: 0.3, z: 0.9 },
    });
    expect(result?.warning).toContain("fell back to root");
  });
});
