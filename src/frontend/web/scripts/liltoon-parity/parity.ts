import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

import { configureAvatarGltfLoader } from "@/lib/avatar/configureAvatarGltfLoader";
import {
  installLilToonRenderingWhenLoaded,
  withOnDemandLilToon,
} from "@/lib/avatar/liltoon/lilToon";
import { applyCanonicalPose } from "@/lib/avatar/motion-authoring/kinematics";

/**
 * Renders a converted Avatar's authored lilToon materials under conditions
 * Unity can reproduce (driven by `scripts/liltoon-parity.mjs`): the rest pose,
 * one white key light and white ambient light, no tone mapping, sRGB output.
 * It returns each view's image and its camera and lights in three.js world
 * coordinates, which `scripts/avatars/unity/AnimamaReferenceRender.cs` reads
 * to render the same views in Unity.
 */

type ParityRequest = { url: string; width: number; height: number };

type ParityView = {
  name: string;
  width: number;
  height: number;
  cameraPosition: number[];
  cameraTarget: number[];
  fov: number;
  /** Toward the light, normalized. */
  lightDirection: number[];
  /** Linear colour times intensity, as lilToon receives it. */
  lightColor: number[];
  /** Linear ambient colour lilToon receives (`unity_SHA*` constant term). */
  ambientColor: number[];
  /** Linear clear colour. */
  background: number[];
};

const KEY_LIGHT_POSITION = new THREE.Vector3(1, 2, 2);
const KEY_LIGHT_INTENSITY = 1;
const AMBIENT_INTENSITY = 0.35;
/** three-liltoon's own ambient floor (`LilToonLightAdapter`). */
const LILTOON_AMBIENT_FLOOR = 0.05;
const FOV = 30;
const BACKGROUND = new THREE.Color(0xf4f3ef);

async function loadVrm(url: string): Promise<VRM> {
  const loader = configureAvatarGltfLoader(new GLTFLoader());
  loader.register((parser) => withOnDemandLilToon(new VRMLoaderPlugin(parser)));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  // No `prepareLoadedVrm`: its rest normalization would re-pose arms and hands
  // toward VRoid's rest, and Unity renders the file's own (exported) rest.
  return vrm;
}

/** Full body from the front, the face from the front and from its right. */
function viewsOf(vrm: VRM) {
  const head = vrm.humanoid
    .getRawBoneNode("head")!
    .getWorldPosition(new THREE.Vector3());
  const body = new THREE.Vector3(0, head.y * 0.55, 0);
  const face = head.clone().add(new THREE.Vector3(0, head.y * 0.05, 0));
  const around = (target: THREE.Vector3, distance: number, angle: number) =>
    new THREE.Vector3(
      target.x + Math.sin(angle) * distance,
      target.y,
      target.z + Math.cos(angle) * distance,
    );
  return [
    {
      name: "body",
      position: around(body, head.y * 2.9, 0).add(
        new THREE.Vector3(0, head.y * 0.1, 0),
      ),
      target: body,
    },
    { name: "face", position: around(face, head.y * 0.6, 0), target: face },
    {
      name: "face-three-quarter",
      position: around(face, head.y * 0.6, -Math.PI / 4),
      target: face,
    },
  ];
}

async function render(request: ParityRequest): Promise<{
  images: { name: string; dataUrl: string }[];
  views: ParityView[];
}> {
  const { width, height } = request;
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const releaseLilToon = installLilToonRenderingWhenLoaded(renderer);
  const scene = new THREE.Scene();
  scene.background = BACKGROUND;
  scene.add(new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const key = new THREE.DirectionalLight(0xffffff, KEY_LIGHT_INTENSITY);
  key.position.copy(KEY_LIGHT_POSITION);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(FOV, width / height, 0.01, 20);

  const vrm = await loadVrm(request.url);
  scene.add(vrm.scene);
  applyCanonicalPose(vrm, {});
  vrm.expressionManager?.update();
  vrm.springBoneManager?.reset();

  const ambient = AMBIENT_INTENSITY + LILTOON_AMBIENT_FLOOR;
  const lightDirection = KEY_LIGHT_POSITION.clone().normalize().toArray();
  const images: { name: string; dataUrl: string }[] = [];
  const views: ParityView[] = [];
  for (const view of viewsOf(vrm)) {
    camera.position.copy(view.position);
    camera.up.set(0, 1, 0);
    camera.lookAt(view.target);
    renderer.render(scene, camera);
    images.push({
      name: view.name,
      dataUrl: renderer.domElement.toDataURL("image/png"),
    });
    views.push({
      name: view.name,
      width,
      height,
      cameraPosition: view.position.toArray(),
      cameraTarget: view.target.toArray(),
      fov: FOV,
      lightDirection,
      lightColor: [
        KEY_LIGHT_INTENSITY,
        KEY_LIGHT_INTENSITY,
        KEY_LIGHT_INTENSITY,
      ],
      ambientColor: [ambient, ambient, ambient],
      background: [BACKGROUND.r, BACKGROUND.g, BACKGROUND.b],
    });
  }
  scene.remove(vrm.scene);
  VRMUtils.deepDispose(vrm.scene);
  releaseLilToon();
  renderer.dispose();
  return { images, views };
}

declare global {
  interface Window {
    renderLilToonParity: typeof render;
    effectRendererReady: boolean;
  }
}

window.renderLilToonParity = render;
window.effectRendererReady = true;
