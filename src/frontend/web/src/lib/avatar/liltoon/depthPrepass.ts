import * as THREE from "three";

/**
 * A depth pre-pass for opaque lilToon primitives.
 *
 * lilToon's fragment shader is far heavier than MToon's, and on the GPUs
 * measured (Apple M5, `effects:bench --breakdown`) the hidden layers of a
 * converted Avatar (body under clothing, hair behind the face, eyeball domes)
 * paid for it in full: drawing each opaque lilToon primitive's depth first,
 * with colour writes off, lets the depth test reject those fragments before
 * the lilToon shader runs. lilToon's own outline pass already does part of
 * this by accident, which is why switching outlines off made frames slower.
 *
 * The pre-pass never changes a pixel. It writes depth only, pushed slightly
 * behind the surface (three-liltoon skins and projects in its own order, so
 * its depth drifts from three.js's by up to about eight units; see
 * `silhouetteOverlay.ts`), so each surface still passes its own test and
 * writes its exact depth, and a fragment it rejects lies behind an opaque
 * surface that covers it. A primitive takes part only when that holds for its
 * material (`takesDepthPrepass`), and a frame skips the pre-pass when any
 * visible material's depth test could see the earlier depth
 * (`toleratesDepthPrepass`).
 *
 * Like lilToon's outlines, the pre-pass meshes exist only while the renderer
 * draws: they are attached as children of their surfaces before each render
 * and detached after it, so nothing that walks an Avatar's scene sees them.
 */

/**
 * How far behind its surface the pre-pass writes depth: a slope factor for
 * grazing triangles and the eight units lilToon's depth drift needs.
 */
export const DEPTH_PREPASS_POLYGON_OFFSET = { factor: 1, units: 8 } as const;

/** The parts of three-liltoon's `LilToonMaterial` the pre-pass reads. */
type LilToonFacts = {
  isLilToonMaterial?: boolean;
  pass?: string;
  renderMode?: string;
};

/** Depth tests that never see a pre-pass's depth where the surface's own was. */
const TOLERANT_DEPTH_FUNCS: ReadonlySet<THREE.DepthModes> = new Set([
  THREE.LessEqualDepth,
  THREE.LessDepth,
  THREE.AlwaysDepth,
]);

/** Why a material takes no depth pre-pass; see `depthPrepassBlocker`. */
export type DepthPrepassBlocker =
  | "not_liltoon_surface"
  | "not_opaque"
  | "blends"
  | "hidden"
  | "no_colour"
  | "depth_state";

/**
 * Why a material may not draw its depth first, or null when it may: an
 * opaque lilToon surface pass that draws every fragment, replaces what is
 * behind it and writes its depth with a less-or-equal test. three-liltoon
 * enables blending on every material, so blending counts as replacing when
 * its colour factors are One and Zero.
 */
export function depthPrepassBlocker(
  material: THREE.Material,
): DepthPrepassBlocker | null {
  const lilToon = material as THREE.Material & LilToonFacts;
  if (!lilToon.isLilToonMaterial || lilToon.pass !== "forward")
    return "not_liltoon_surface";
  if (lilToon.renderMode !== "opaque" || material.transparent)
    return "not_opaque";
  const replaces =
    material.blending === THREE.NoBlending ||
    (material.blending === THREE.CustomBlending &&
      material.blendEquation === THREE.AddEquation &&
      material.blendSrc === THREE.OneFactor &&
      material.blendDst === THREE.ZeroFactor);
  if (!replaces) return "blends";
  if (!material.visible) return "hidden";
  if (!material.colorWrite) return "no_colour";
  if (
    !material.depthTest ||
    !material.depthWrite ||
    (material.depthFunc !== THREE.LessEqualDepth &&
      material.depthFunc !== THREE.LessDepth)
  )
    return "depth_state";
  return null;
}

/** Whether a material may draw its depth first (`depthPrepassBlocker`). */
export function takesDepthPrepass(material: THREE.Material): boolean {
  return depthPrepassBlocker(material) === null;
}

/**
 * Whether a material's drawing is unaffected by depth written early: it
 * tests less, less-or-equal, always, or not at all. A greater, equal or
 * not-equal test (a see-through trick, say) could draw where the pre-pass's
 * depth sits. With a stencil buffer, a stencil write could also change: a
 * fragment the pre-pass rejects takes the depth-fail stencil operation
 * instead of the pass one. A scene holding such a material draws without the
 * pre-pass. Avatar canvases have no stencil buffer, so lilToon's stencil
 * settings (eyes drawn through hair, say) do nothing there.
 */
export function toleratesDepthPrepass(
  material: THREE.Material,
  stencilBuffer: boolean,
): boolean {
  if (!material.visible) return true;
  if (stencilBuffer && material.stencilWrite) return false;
  return !material.depthTest || TOLERANT_DEPTH_FUNCS.has(material.depthFunc);
}

function materialsOf(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

/**
 * The visible single-material meshes of `scene` that take a pre-pass, or
 * none when a visible material would not tolerate one on a target with or
 * without a stencil buffer. `helpers` (the pre-pass meshes themselves) are
 * skipped.
 */
export function depthPrepassMeshes(
  scene: THREE.Object3D,
  helpers: ReadonlySet<THREE.Object3D> | WeakSet<THREE.Object3D>,
  stencilBuffer: boolean,
): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  let tolerated = true;
  scene.traverseVisible((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh || helpers.has(mesh)) return;
    const materials = materialsOf(mesh);
    if (
      !materials.every((material) =>
        toleratesDepthPrepass(material, stencilBuffer),
      )
    )
      tolerated = false;
    if (materials.length === 1 && takesDepthPrepass(materials[0]!))
      meshes.push(mesh);
  });
  return tolerated ? meshes : [];
}

/** Whether `renderer` draws into a stencil buffer now (assumed when unknown). */
function targetHasStencil(renderer: THREE.WebGLRenderer): boolean {
  const target = renderer.getRenderTarget();
  if (target) return target.stencilBuffer;
  try {
    return renderer.getContext().getContextAttributes()?.stencil ?? true;
  } catch {
    return true;
  }
}

type PrepassState = { enabled: boolean };

const installations = new WeakMap<THREE.WebGLRenderer, PrepassState>();

/**
 * Draw opaque lilToon primitives' depth first on `renderer` (installed with
 * lilToon's own passes). Returns the release, which restores `render`.
 */
export function installLilToonDepthPrepass(
  renderer: THREE.WebGLRenderer,
): () => void {
  const state: PrepassState = { enabled: true };
  const helpers = new WeakSet<THREE.Object3D>();
  const proxies = new WeakMap<THREE.Mesh, THREE.Mesh>();
  const materials = new Map<THREE.Side, THREE.MeshBasicMaterial>();
  const materialFor = (side: THREE.Side) => {
    let material = materials.get(side);
    if (!material) {
      material = new THREE.MeshBasicMaterial({
        name: "lilToon depth pre-pass",
        colorWrite: false,
        side,
        polygonOffset: true,
        polygonOffsetFactor: DEPTH_PREPASS_POLYGON_OFFSET.factor,
        polygonOffsetUnits: DEPTH_PREPASS_POLYGON_OFFSET.units,
      });
      materials.set(side, material);
    }
    return material;
  };

  const proxyFor = (mesh: THREE.Mesh): THREE.Mesh => {
    const surface = mesh.material as THREE.Material;
    let proxy = proxies.get(mesh);
    if (!proxy) {
      proxy = (mesh as THREE.SkinnedMesh).isSkinnedMesh
        ? new THREE.SkinnedMesh(mesh.geometry, materialFor(surface.side))
        : new THREE.Mesh(mesh.geometry, materialFor(surface.side));
      proxy.name = `${mesh.name}:lilToon-depth-prepass`;
      proxy.matrixAutoUpdate = false;
      proxy.raycast = () => undefined;
      helpers.add(proxy);
      proxies.set(mesh, proxy);
    }
    proxy.geometry = mesh.geometry;
    proxy.material = materialFor(surface.side);
    proxy.morphTargetDictionary = mesh.morphTargetDictionary;
    proxy.morphTargetInfluences = mesh.morphTargetInfluences;
    proxy.layers.mask = mesh.layers.mask;
    proxy.frustumCulled = mesh.frustumCulled;
    // Before lilToon's outline proxies (renderOrder − 1) and the surface.
    proxy.renderOrder = mesh.renderOrder - 2;
    const skinned = mesh as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh) {
      const skinnedProxy = proxy as THREE.SkinnedMesh;
      skinnedProxy.skeleton = skinned.skeleton;
      skinnedProxy.bindMode = skinned.bindMode;
      skinnedProxy.bindMatrix.copy(skinned.bindMatrix);
      skinnedProxy.bindMatrixInverse.copy(skinned.bindMatrixInverse);
      skinnedProxy.boundingBox = skinned.boundingBox;
      skinnedProxy.boundingSphere = skinned.boundingSphere;
    }
    return proxy;
  };

  const render = renderer.render;
  const wrapped: THREE.WebGLRenderer["render"] = function (scene, camera) {
    const attached: THREE.Mesh[] = [];
    // An override material would draw the pre-pass in colour.
    if (state.enabled && !(scene as THREE.Scene).overrideMaterial) {
      for (const mesh of depthPrepassMeshes(
        scene,
        helpers,
        targetHasStencil(renderer),
      )) {
        const proxy = proxyFor(mesh);
        mesh.add(proxy);
        // Its local transform is the identity: the surface's world matrix.
        proxy.matrixWorld.copy(mesh.matrixWorld);
        attached.push(proxy);
      }
    }
    try {
      render.call(renderer, scene, camera);
    } finally {
      for (const proxy of attached) proxy.removeFromParent();
    }
  };
  renderer.render = wrapped;
  installations.set(renderer, state);
  return () => {
    if (renderer.render === wrapped) renderer.render = render;
    installations.delete(renderer);
    for (const material of materials.values()) material.dispose();
    materials.clear();
  };
}

/**
 * Switch the pre-pass on `renderer` off or on again, for benchmarks that
 * time it (`effects:bench --breakdown features`). No-op where it is not
 * installed.
 */
export function setLilToonDepthPrepassEnabled(
  renderer: THREE.WebGLRenderer,
  enabled: boolean,
): void {
  const state = installations.get(renderer);
  if (state) state.enabled = enabled;
}

/** Whether `renderer` draws the pre-pass (installed and enabled). */
export function lilToonDepthPrepassEnabled(
  renderer: THREE.WebGLRenderer,
): boolean {
  return installations.get(renderer)?.enabled ?? false;
}
