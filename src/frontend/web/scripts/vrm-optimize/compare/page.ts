import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { configureAvatarGltfLoader } from "@/lib/avatar/configureAvatarGltfLoader";
import { withEnhancedMToonPatch } from "@/lib/avatar/enhanced-rendering/mtoonPatch";
import { applyCanonicalPose } from "@/lib/avatar/motion-authoring/kinematics";
import { canonicalizeCustomPresetExpressions } from "@/lib/avatar/vrmExpressionPresets";

/**
 * Renders fixed views of VRM files with the app's MToon patch, for comparing
 * an optimized Avatar with its source (`pnpm -s vrm:optimize compare`).
 */

type View = {
  name: string;
  width: number;
  height: number;
  frame: (vrm: VRM, camera: THREE.PerspectiveCamera) => void;
};

const bone = (vrm: VRM, name: string) =>
  vrm.humanoid
    .getNormalizedBoneNode(name as never)!
    .getWorldPosition(new THREE.Vector3());

/** Aim the camera at `target` from `distance` away, `angle` radians around Y. */
function look(
  camera: THREE.PerspectiveCamera,
  target: THREE.Vector3,
  distance: number,
  angle = 0,
) {
  camera.position.set(
    target.x + Math.sin(angle) * distance,
    target.y,
    target.z + Math.cos(angle) * distance,
  );
  camera.lookAt(target);
}

const VIEWS: View[] = [
  {
    name: "body",
    width: 520,
    height: 1000,
    frame: (vrm, camera) => {
      const head = bone(vrm, "head").y;
      look(camera, new THREE.Vector3(0, head * 0.53, 0), head * 2.15);
    },
  },
  {
    name: "torso",
    width: 760,
    height: 760,
    frame: (vrm, camera) => {
      const chest = bone(vrm, "upperChest");
      look(camera, chest.setY(chest.y - 0.08), 0.95, 0.35);
    },
  },
  {
    name: "face",
    width: 760,
    height: 760,
    frame: (vrm, camera) => {
      const head = bone(vrm, "head");
      look(camera, head.setY(head.y + 0.07), 0.55);
    },
  },
  {
    name: "back",
    width: 760,
    height: 760,
    frame: (vrm, camera) => {
      const spine = bone(vrm, "spine");
      look(camera, spine.setY(spine.y + 0.05), 1.2, Math.PI * 0.85);
    },
  },
];

/** Arms lowered from the T-pose so the torso and sides are visible. */
const ARM_DROP = 1.15;
const RELAXED_ARMS = {
  leftUpperArm: {
    rotation: [0, 0, -Math.sin(ARM_DROP / 2), Math.cos(ARM_DROP / 2)],
  },
  rightUpperArm: {
    rotation: [0, 0, Math.sin(ARM_DROP / 2), Math.cos(ARM_DROP / 2)],
  },
} as const;

async function render(
  files: { key: string; url: string }[],
): Promise<Record<string, string>> {
  const shots: Record<string, string> = {};
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeeeae4);
  scene.add(new THREE.AmbientLight(0xffffff, 1.4));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(1, 2, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  for (const file of files) {
    const loader = configureAvatarGltfLoader(new GLTFLoader());
    loader.register((parser) =>
      withEnhancedMToonPatch(new VRMLoaderPlugin(parser)),
    );
    const gltf = await loader.loadAsync(file.url);
    const vrm = gltf.userData.vrm as VRM;
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.rotateVRM0(vrm);
    canonicalizeCustomPresetExpressions(vrm);
    scene.add(vrm.scene);
    applyCanonicalPose(vrm, RELAXED_ARMS as never);
    vrm.update(0);
    vrm.springBoneManager?.reset();
    for (const view of VIEWS) {
      renderer.setSize(view.width, view.height);
      camera.aspect = view.width / view.height;
      camera.updateProjectionMatrix();
      view.frame(vrm, camera);
      renderer.render(scene, camera);
      shots[`${file.key}.${view.name}`] =
        renderer.domElement.toDataURL("image/png");
    }
    scene.remove(vrm.scene);
    VRMUtils.deepDispose(vrm.scene);
  }
  renderer.dispose();
  return shots;
}

declare global {
  interface Window {
    renderVrmComparison?: typeof render;
    vrmComparisonReady?: boolean;
  }
}

window.renderVrmComparison = render;
window.vrmComparisonReady = true;
