import { LilToonMaterial } from "@mochiya/three-liltoon";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  DEPTH_PREPASS_POLYGON_OFFSET,
  depthPrepassBlocker,
  depthPrepassMeshes,
  installLilToonDepthPrepass,
  lilToonDepthPrepassEnabled,
  setLilToonDepthPrepassEnabled,
  takesDepthPrepass,
  toleratesDepthPrepass,
} from "./depthPrepass";

/**
 * A stand-in for three-liltoon's `LilToonMaterial` with the render state
 * `applyLilToonRenderState` gives an opaque surface pass.
 */
function lilToonMaterial(
  overrides: Partial<{
    pass: string;
    renderMode: string;
    blendSrc: THREE.BlendingSrcFactor;
    blendDst: THREE.BlendingDstFactor;
    blendSrcAlpha: THREE.BlendingSrcFactor;
    blendDstAlpha: THREE.BlendingDstFactor;
    alphaToCoverage: boolean;
    polygonOffset: boolean;
    polygonOffsetUnits: number;
    depthFunc: THREE.DepthModes;
    depthWrite: boolean;
    transparent: boolean;
    stencilWrite: boolean;
    side: THREE.Side;
  }> = {},
): THREE.Material {
  const material = new THREE.MeshBasicMaterial({
    blending: THREE.CustomBlending,
    blendSrc: overrides.blendSrc ?? THREE.OneFactor,
    blendDst: overrides.blendDst ?? THREE.ZeroFactor,
    blendSrcAlpha: overrides.blendSrcAlpha ?? null,
    blendDstAlpha: overrides.blendDstAlpha ?? null,
    alphaToCoverage: overrides.alphaToCoverage ?? false,
    polygonOffset: overrides.polygonOffset ?? false,
    polygonOffsetUnits: overrides.polygonOffsetUnits ?? 0,
    depthFunc: overrides.depthFunc ?? THREE.LessEqualDepth,
    depthWrite: overrides.depthWrite ?? true,
    transparent: overrides.transparent ?? false,
    stencilWrite: overrides.stencilWrite ?? false,
    side: overrides.side ?? THREE.FrontSide,
  });
  return Object.assign(material, {
    isLilToonMaterial: true,
    pass: overrides.pass ?? "forward",
    renderMode: overrides.renderMode ?? "opaque",
  });
}

function skinnedMesh(material: THREE.Material): THREE.SkinnedMesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  const mesh = new THREE.SkinnedMesh(geometry, material);
  const bone = new THREE.Bone();
  mesh.add(bone);
  mesh.bind(new THREE.Skeleton([bone]));
  mesh.morphTargetInfluences = [0.25];
  mesh.renderOrder = 3;
  return mesh;
}

/** A renderer stand-in that records each frame's pre-pass meshes. */
function recordingRenderer({ stencil = false } = {}) {
  const frames: THREE.Mesh[][] = [];
  const renderer = {
    getRenderTarget: () => null,
    getContext: () => ({ getContextAttributes: () => ({ stencil }) }),
    render(scene: THREE.Object3D) {
      const proxies: THREE.Mesh[] = [];
      scene.traverse((object) => {
        if (object.name.endsWith(":lilToon-depth-prepass"))
          proxies.push(object as THREE.Mesh);
      });
      frames.push(proxies);
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, frames };
}

describe("takesDepthPrepass", () => {
  it("accepts an opaque lilToon surface pass", () => {
    expect(takesDepthPrepass(lilToonMaterial())).toBe(true);
    const unblended = lilToonMaterial();
    unblended.blending = THREE.NoBlending;
    expect(takesDepthPrepass(unblended)).toBe(true);
  });

  it("accepts alpha factors that replace, set or inherited", () => {
    expect(
      takesDepthPrepass(
        lilToonMaterial({
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.ZeroFactor,
        }),
      ),
    ).toBe(true);
  });

  it("refuses surfaces whose alpha, coverage or depth could differ", () => {
    // three-liltoon's default alpha factors: One, One minus source alpha.
    expect(
      depthPrepassBlocker(
        lilToonMaterial({
          blendSrcAlpha: THREE.OneFactor,
          blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
        }),
      ),
    ).toBe("blends_alpha");
    expect(
      depthPrepassBlocker(
        lilToonMaterial({ blendSrcAlpha: THREE.SrcAlphaFactor }),
      ),
    ).toBe("blends_alpha");
    expect(
      depthPrepassBlocker(lilToonMaterial({ alphaToCoverage: true })),
    ).toBe("alpha_to_coverage");
    // A positive authored offset would put the surface behind its pre-pass.
    expect(
      depthPrepassBlocker(
        lilToonMaterial({ polygonOffset: true, polygonOffsetUnits: 4 }),
      ),
    ).toBe("polygon_offset");
  });

  it("refuses anything whose hidden fragments could show or count", () => {
    for (const material of [
      new THREE.MeshBasicMaterial(),
      lilToonMaterial({ pass: "outline" }),
      lilToonMaterial({ renderMode: "cutout" }),
      lilToonMaterial({ renderMode: "transparent", transparent: true }),
      lilToonMaterial({ blendDst: THREE.OneMinusSrcAlphaFactor }),
      lilToonMaterial({ blendSrc: THREE.SrcAlphaFactor }),
      lilToonMaterial({ depthWrite: false }),
      lilToonMaterial({ depthFunc: THREE.AlwaysDepth }),
    ])
      expect(takesDepthPrepass(material)).toBe(false);
    const hidden = lilToonMaterial();
    hidden.visible = false;
    expect(takesDepthPrepass(hidden)).toBe(false);
  });

  it("refuses a surface lilToon's Invisible toggle hides", () => {
    // The installed three-liltoon: its opaque surfaces draw unblended
    // (Animama's patch), and `_Invisible` collapses the vertices in the shader.
    const shown = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: {},
    });
    expect(depthPrepassBlocker(shown)).toBeNull();
    const invisible = new LilToonMaterial({
      shaderVariant: "lilToon",
      properties: { _Invisible: 1 },
    });
    expect(depthPrepassBlocker(invisible)).toBe("hidden");
    shown.dispose();
    invisible.dispose();
  });
});

describe("toleratesDepthPrepass", () => {
  it("accepts less, less-or-equal, always and untested depth", () => {
    expect(toleratesDepthPrepass(new THREE.MeshBasicMaterial(), false)).toBe(
      true,
    );
    expect(
      toleratesDepthPrepass(
        new THREE.MeshBasicMaterial({ depthFunc: THREE.AlwaysDepth }),
        false,
      ),
    ).toBe(true);
    expect(
      toleratesDepthPrepass(
        new THREE.MeshBasicMaterial({
          depthFunc: THREE.GreaterDepth,
          depthTest: false,
        }),
        false,
      ),
    ).toBe(true);
  });

  it("refuses depth tests that could see earlier depth", () => {
    for (const depthFunc of [
      THREE.GreaterDepth,
      THREE.GreaterEqualDepth,
      THREE.EqualDepth,
      THREE.NotEqualDepth,
    ])
      expect(
        toleratesDepthPrepass(
          new THREE.MeshBasicMaterial({ depthFunc }),
          false,
        ),
      ).toBe(false);
  });

  it("refuses stencil writes only where a stencil buffer records them", () => {
    const writer = lilToonMaterial({ stencilWrite: true });
    expect(toleratesDepthPrepass(writer, false)).toBe(true);
    expect(toleratesDepthPrepass(writer, true)).toBe(false);
    // Without a stencil buffer the writer takes the pre-pass itself.
    expect(takesDepthPrepass(writer)).toBe(true);
  });
});

describe("depthPrepassMeshes", () => {
  it("lists visible opaque lilToon meshes only", () => {
    const scene = new THREE.Scene();
    const opaque = skinnedMesh(lilToonMaterial());
    const cutout = skinnedMesh(lilToonMaterial({ renderMode: "cutout" }));
    const hidden = skinnedMesh(lilToonMaterial());
    hidden.visible = false;
    const mtoon = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const multi = new THREE.Mesh(new THREE.BufferGeometry(), [
      lilToonMaterial(),
      lilToonMaterial(),
    ]);
    scene.add(opaque, cutout, hidden, mtoon, multi);
    expect(depthPrepassMeshes(scene, new WeakSet(), false)).toEqual([opaque]);
  });

  it("lists none when a visible material would see the earlier depth", () => {
    const scene = new THREE.Scene();
    scene.add(
      skinnedMesh(lilToonMaterial()),
      new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({ depthFunc: THREE.GreaterDepth }),
      ),
    );
    expect(depthPrepassMeshes(scene, new WeakSet(), false)).toEqual([]);
  });
});

describe("installLilToonDepthPrepass", () => {
  it("draws a depth-only copy of each opaque lilToon mesh during render only", () => {
    const { renderer, frames } = recordingRenderer();
    const scene = new THREE.Scene();
    const surface = skinnedMesh(lilToonMaterial({ side: THREE.DoubleSide }));
    scene.add(surface);
    const release = installLilToonDepthPrepass(renderer);

    renderer.render(scene, new THREE.PerspectiveCamera());
    renderer.render(scene, new THREE.PerspectiveCamera());

    expect(frames.map((frame) => frame.length)).toEqual([1, 1]);
    const proxy = frames[0]![0] as THREE.SkinnedMesh;
    // The same proxy is reused frame to frame and detached between them.
    expect(frames[1]![0]).toBe(proxy);
    expect(proxy.parent).toBeNull();
    expect(surface.children).not.toContain(proxy);
    expect(proxy.geometry).toBe(surface.geometry);
    expect(proxy.skeleton).toBe(surface.skeleton);
    expect(proxy.morphTargetInfluences).toBe(surface.morphTargetInfluences);
    expect(proxy.renderOrder).toBe(surface.renderOrder - 2);
    const material = proxy.material as THREE.MeshBasicMaterial;
    expect(material.colorWrite).toBe(false);
    expect(material.depthWrite).toBe(true);
    expect(material.side).toBe(THREE.DoubleSide);
    expect(material.polygonOffsetFactor).toBe(
      DEPTH_PREPASS_POLYGON_OFFSET.factor,
    );
    expect(material.polygonOffsetUnits).toBe(
      DEPTH_PREPASS_POLYGON_OFFSET.units,
    );

    release();
    renderer.render(scene, new THREE.PerspectiveCamera());
    expect(frames[2]).toEqual([]);
  });

  it("skips frames whose stencil buffer a stencil-writing material uses", () => {
    const { renderer, frames } = recordingRenderer({ stencil: true });
    const scene = new THREE.Scene();
    scene.add(
      skinnedMesh(lilToonMaterial()),
      skinnedMesh(lilToonMaterial({ stencilWrite: true })),
    );
    const release = installLilToonDepthPrepass(renderer);
    renderer.render(scene, new THREE.PerspectiveCamera());
    expect(frames).toEqual([[]]);
    release();
  });

  it("shares one installation per renderer until the last release", () => {
    const { renderer, frames } = recordingRenderer();
    const scene = new THREE.Scene();
    scene.add(skinnedMesh(lilToonMaterial()));
    const first = installLilToonDepthPrepass(renderer);
    const second = installLilToonDepthPrepass(renderer);

    renderer.render(scene, new THREE.PerspectiveCamera());
    first();
    first();
    renderer.render(scene, new THREE.PerspectiveCamera());
    second();
    renderer.render(scene, new THREE.PerspectiveCamera());

    // One pre-pass mesh per frame, not two; none after the last release.
    expect(frames.map((frame) => frame.length)).toEqual([1, 1, 0]);
    expect(lilToonDepthPrepassEnabled(renderer)).toBe(false);
  });

  it("can be switched off and skips scenes with an override material", () => {
    const { renderer, frames } = recordingRenderer();
    const scene = new THREE.Scene();
    scene.add(skinnedMesh(lilToonMaterial()));
    const release = installLilToonDepthPrepass(renderer);
    expect(lilToonDepthPrepassEnabled(renderer)).toBe(true);

    setLilToonDepthPrepassEnabled(renderer, false);
    renderer.render(scene, new THREE.PerspectiveCamera());
    setLilToonDepthPrepassEnabled(renderer, true);
    scene.overrideMaterial = new THREE.MeshBasicMaterial();
    renderer.render(scene, new THREE.PerspectiveCamera());

    expect(frames).toEqual([[], []]);
    release();
    expect(lilToonDepthPrepassEnabled(renderer)).toBe(false);
  });
});
