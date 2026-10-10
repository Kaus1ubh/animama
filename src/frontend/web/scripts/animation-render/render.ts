import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { getResolvedAvatarPose } from "@/lib/avatar/poses/catalog";
import { canonicalizeCustomPresetExpressions } from "@/lib/avatar/vrmExpressionPresets";
import { applyCanonicalPose } from "@/lib/avatar/motion-authoring/kinematics";

/**
 * Review-sheet renderer for generated Gestures (driven by
 * `scripts/animation-render.mjs`). It plays a clip through the production
 * sampler and VRM 0 conversion on textured Avatars and draws a labelled grid:
 * one row per sampled time, one column per Avatar × view. Live procedural
 * layers are not applied, matching the Gesture creator preview. Both clip
 * schemas are supported.
 */

type RenderRequest = {
  clip: unknown;
  avatars: { id: string; url: string }[];
  times: number[];
  tile: { width: number; height: number };
  /** Which of the Avatar's own sides the ¾ and side views look from. */
  side: "left" | "right";
};

/**
 * Camera angles around the Avatar (0 = facing it). The Avatar's own left is
 * +X, so the front view shows its right hand on the viewer's left.
 */
const viewsFor = (side: "left" | "right") => {
  const sign = side === "left" ? 1 : -1;
  return [
    { name: "front", angle: 0, face: false },
    { name: `3/4 ${side}`, angle: (sign * Math.PI) / 4, face: false },
    { name: `${side} side`, angle: (sign * Math.PI) / 2, face: false },
    { name: "face", angle: 0, face: true },
  ];
};

async function loadVrm(url: string): Promise<VRM> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  canonicalizeCustomPresetExpressions(vrm);
  return vrm;
}

function applyExpressions(vrm: VRM, expressions: Record<string, number>) {
  const manager = vrm.expressionManager;
  if (!manager) return;
  for (const expression of manager.expressions)
    manager.setValue(expression.expressionName, 0);
  for (const [name, weight] of Object.entries(expressions))
    if (manager.getExpression(name)) manager.setValue(name, weight);
  manager.update();
}

async function render(
  request: RenderRequest,
): Promise<{ dataUrl: string; missingPoseRefs: string[] }> {
  const missingPoseRefs = new Set<string>();
  const { width, height } = request.tile;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f3ef);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);

  // Resolve references from the app catalog, as playback does.
  const resolvePose = (id: string) => {
    try {
      return getResolvedAvatarPose(id);
    } catch {
      return null;
    }
  };
  const VIEWS = viewsFor(request.side);
  const columns = request.avatars.length * VIEWS.length;
  const header = 28;
  const label = 64;
  const sheet = document.createElement("canvas");
  sheet.width = label + columns * width;
  sheet.height = header + request.times.length * height;
  const context = sheet.getContext("2d")!;
  context.fillStyle = "#f4f3ef";
  context.fillRect(0, 0, sheet.width, sheet.height);
  context.fillStyle = "#222";
  context.font = "13px sans-serif";

  let column = 0;
  for (const avatar of request.avatars) {
    const vrm = await loadVrm(avatar.url);
    scene.add(vrm.scene);
    // 2.0 clips are prepared per Avatar (hand presets, planted legs).
    const program = createAnimaPoseClipProgram(
      parseAnimaPoseClip(request.clip),
      { vrm, resolvePose },
    );
    applyCanonicalPose(vrm, {});
    const head = vrm.humanoid
      .getRawBoneNode("head")!
      .getWorldPosition(new THREE.Vector3());
    const target = new THREE.Vector3(0, head.y * 0.55, 0);
    const distance = head.y * 2.9;
    VIEWS.forEach((view, viewIndex) => {
      context.fillText(
        `${avatar.id.replace("AvatarSample_", "")} · ${view.name}`,
        label + (column + viewIndex) * width + 6,
        18,
      );
    });
    request.times.forEach((time, row) => {
      const result = program.sample(time);
      result.diagnostics.missingPoseRefs.forEach((id) =>
        missingPoseRefs.add(id),
      );
      const sample = result.sample;
      applyCanonicalPose(vrm, sample.humanoid ?? {});
      applyExpressions(vrm, sample.expressions ?? {});
      vrm.springBoneManager?.reset();
      VIEWS.forEach((view, viewIndex) => {
        if (view.face) {
          // Close-up on the current head position so expressions are readable.
          const face = vrm.humanoid
            .getRawBoneNode("head")!
            .getWorldPosition(new THREE.Vector3())
            .add(new THREE.Vector3(0, head.y * 0.05, 0));
          camera.position.set(face.x, face.y, face.z + head.y * 0.6);
          camera.lookAt(face);
        } else {
          camera.position.set(
            Math.sin(view.angle) * distance,
            target.y + head.y * 0.1,
            Math.cos(view.angle) * distance,
          );
          camera.lookAt(target);
        }
        renderer.render(scene, camera);
        context.drawImage(
          renderer.domElement,
          label + (column + viewIndex) * width,
          header + row * height,
        );
      });
      if (column === 0)
        context.fillText(`${time.toFixed(2)}s`, 8, header + row * height + 18);
    });
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
    column += VIEWS.length;
  }
  renderer.dispose();
  return {
    dataUrl: sheet.toDataURL("image/png"),
    missingPoseRefs: [...missingPoseRefs],
  };
}

declare global {
  interface Window {
    renderGestureSheet: (
      request: RenderRequest,
    ) => Promise<{ dataUrl: string; missingPoseRefs: string[] }>;
    gestureRendererReady: boolean;
  }
}

window.renderGestureSheet = render;
window.gestureRendererReady = true;
