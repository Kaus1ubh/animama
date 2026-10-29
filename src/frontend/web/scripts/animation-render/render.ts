import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

import { Avatar } from "@/lib/avatar/Avatar";
import {
  headSized,
  measureAvatarProportions,
} from "@/lib/avatar/avatarProportions";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { getResolvedAvatarPose } from "@/lib/avatar/poses/catalog";
import { canonicalizeCustomPresetExpressions } from "@/lib/avatar/vrmExpressionPresets";
import { configureAvatarGltfLoader } from "@/lib/avatar/configureAvatarGltfLoader";
import { prepareLoadedVrm } from "@/lib/avatar/prepareLoadedVrm";
import { UnmetallicMaterialsPlugin } from "@/lib/avatar/unmetallicMaterials";
import {
  installLilToonRenderingWhenLoaded,
  withOnDemandLilToon,
} from "@/lib/avatar/liltoon/lilToon";
import { applyCanonicalPose } from "@/lib/avatar/motion-authoring/kinematics";

import { avatarFileSha256 } from "../effect-render/avatarFile";

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
  /** `body` (whole Avatar and face) or `hands` (close-ups of the `side` hand). */
  view?: "body" | "hands";
};

type View = {
  name: string;
  angle: number;
  face?: boolean;
  /** Hand close-ups: around the Avatar at `angle`, from below the front, or facing the palm. */
  hand?: "world" | "below" | "palm";
};

/**
 * Camera angles around the Avatar (0 = facing it). The Avatar's own left is
 * +X, so the front view shows its right hand on the viewer's left.
 */
const viewsFor = (
  side: "left" | "right",
  view: "body" | "hands" = "body",
): View[] => {
  const sign = side === "left" ? 1 : -1;
  if (view === "hands")
    return [
      { name: `${side} hand front`, angle: 0, hand: "world" },
      { name: `${side} hand 3/4`, angle: (sign * Math.PI) / 4, hand: "world" },
      { name: `${side} hand below`, angle: 0, hand: "below" },
      { name: `${side} palm`, angle: 0, hand: "palm" },
    ];
  return [
    { name: "front", angle: 0, face: false },
    { name: `3/4 ${side}`, angle: (sign * Math.PI) / 4, face: false },
    { name: `${side} side`, angle: (sign * Math.PI) / 2, face: false },
    { name: "face", angle: 0, face: true },
  ];
};

async function loadVrm(url: string): Promise<VRM> {
  const loader = configureAvatarGltfLoader(new GLTFLoader());
  // Authored lilToon materials render as in the app, and lit glTF materials
  // without metalness as the app draws them; MToon is untouched.
  loader.register((parser) => withOnDemandLilToon(new VRMLoaderPlugin(parser)));
  loader.register((parser) => new UnmetallicMaterialsPlugin(parser));
  const gltf = await loader.loadAsync(url);
  const vrm = gltf.userData.vrm as VRM;
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  canonicalizeCustomPresetExpressions(vrm);
  prepareLoadedVrm(vrm, { vrmSha256: await avatarFileSha256(url) });
  await measureFace(vrm, gltf);
  return vrm;
}

/**
 * Find and measure the face as the app does (face parts, landmarks and
 * texture anchors), which registers it for size-aware contacts and framing
 * (`avatarProportions.ts`), before any clip is prepared.
 */
async function measureFace(vrm: VRM, gltf: GLTF): Promise<void> {
  const avatar = new Avatar(new THREE.PerspectiveCamera());
  avatar.vrm = vrm;
  avatar.sourceGltf = gltf;
  await avatar.setFacePartCorrections(null);
}

/**
 * The Included Avatars' rest height of the head bone (m) and of the top of the
 * head over it: big-headed Avatars are framed as a reference Avatar of their
 * head's size would be.
 */
const REFERENCE_HEAD_BONE_HEIGHT = 1.35;
const REFERENCE_TOP_OVER_HEAD_BONE = 1.15;

/**
 * The lengths the views are framed by: the head bone's height `headY` for
 * adult proportions. A big head (`avatarProportions.ts`) frames the body
 * views by the top of the head, so its head stays in view, and the face view
 * by the face's size, so it shows the face rather than the chin.
 */
function framingLengths(
  vrm: VRM,
  headY: number,
): { bodyLength: number; faceLength: number } {
  const proportions = measureAvatarProportions(vrm);
  const top = headY + (proportions.headBox?.max.y ?? 0);
  return {
    bodyLength: headSized(
      proportions,
      headY,
      Math.max(headY, top / REFERENCE_TOP_OVER_HEAD_BONE),
    ),
    faceLength: headSized(
      proportions,
      headY,
      REFERENCE_HEAD_BONE_HEIGHT * proportions.headScale,
    ),
  };
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
  // lilToon's outline and extra passes, as the app canvases install them.
  const releaseLilToon = installLilToonRenderingWhenLoaded(renderer);
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
  const VIEWS = viewsFor(request.side, request.view);
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
    const { bodyLength, faceLength } = framingLengths(vrm, head.y);
    const target = new THREE.Vector3(0, bodyLength * 0.55, 0);
    const distance = bodyLength * 2.9;
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
        if (view.hand) {
          // Close-up centred on the palm, wide enough to show what it touches.
          const bone = (name: string) =>
            vrm.humanoid
              .getNormalizedBoneNode(name as never)
              ?.getWorldPosition(new THREE.Vector3());
          const wrist = bone(`${request.side}Hand`)!;
          const middle = bone(`${request.side}MiddleProximal`) ?? wrist;
          const index = bone(`${request.side}IndexProximal`) ?? middle;
          const little = bone(`${request.side}LittleProximal`) ?? middle;
          const palm = wrist.clone().lerp(middle, 0.7);
          const forward = middle.clone().sub(wrist).normalize();
          const across = index.clone().sub(little).normalize();
          // Toward the palm side (fingers curl this way) for either hand.
          const palmward =
            request.side === "right"
              ? across.clone().cross(forward)
              : forward.clone().cross(across);
          const direction =
            view.hand === "palm"
              ? palmward.normalize().add(forward.clone().multiplyScalar(0.25))
              : view.hand === "below"
                ? new THREE.Vector3(0, -0.7, 1)
                : new THREE.Vector3(
                    Math.sin(view.angle),
                    0.15,
                    Math.cos(view.angle),
                  );
          const reach = head.y * 0.32;
          camera.position
            .copy(palm)
            .addScaledVector(direction.normalize(), reach);
          camera.up.set(0, 1, 0);
          camera.lookAt(palm);
        } else if (view.face) {
          // Close-up on the current head position so expressions are readable.
          const face = vrm.humanoid
            .getRawBoneNode("head")!
            .getWorldPosition(new THREE.Vector3())
            .add(new THREE.Vector3(0, faceLength * 0.05, 0));
          camera.position.set(face.x, face.y, face.z + faceLength * 0.6);
          camera.lookAt(face);
        } else {
          camera.position.set(
            Math.sin(view.angle) * distance,
            target.y + bodyLength * 0.1,
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
  releaseLilToon();
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
