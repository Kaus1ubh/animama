import * as THREE from "three";

import type { Avatar } from "../Avatar";
import type { AvatarFaceEyeLandmarkSnapshot } from "./landmark-types";
import type { AvatarFaceTextureAnchorSnapshot } from "./texture-anchor-types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("AvatarFaceDebugBox");
const DEBUG_COLOR = 0x00e5ff;
const LEFT_EYE_COLOR = 0x5cf26c;
const RIGHT_EYE_COLOR = 0xffb347;
const MOUTH_COLOR = 0xff5f8a;
const GUIDE_OPACITY = 0.9;
const EDGE_OPACITY = 0.95;
const MIN_EXTENT = 0.001;
const MARKER_SCALE = 0.045;
const MIN_MARKER_RADIUS = 0.0025;
const MOUTH_HOVER_SURFACE_LERP = 0.35;

function clampExtent(value: number): number {
  return Math.max(MIN_EXTENT, Number.isFinite(value) ? value : 0);
}

function toVector3(value: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z);
}

function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
}

function disposeObjectTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const geometry = (object as THREE.Mesh).geometry;
    if (geometry instanceof THREE.BufferGeometry) {
      geometry.dispose();
    }
    const material = (object as THREE.Mesh).material;
    if (material instanceof THREE.Material || Array.isArray(material)) {
      disposeMaterial(material);
    }
  });
}

export class AvatarFaceDebugBox {
  private readonly _avatar: Avatar;
  private _helper: THREE.Group | null = null;
  private _isDisposed = false;

  constructor(avatar: Avatar) {
    this._avatar = avatar;
    this._attach();
  }

  get isAttached(): boolean {
    return this._helper !== null;
  }

  setVisible(visible: boolean): void {
    if (!this._helper) return;
    this._helper.visible = visible;
  }

  dispose(): void {
    if (this._isDisposed) return;
    this._isDisposed = true;
    if (this._helper) {
      this._helper.removeFromParent();
      disposeObjectTree(this._helper);
      this._helper = null;
    }
  }

  private _attach(): void {
    const faceLandmarks = this._avatar.faceLandmarks;
    const faceSnapshot = faceLandmarks?.getSnapshot() ?? null;
    const faceTextureAnchors = this._avatar.getFaceTextureAnchorsSnapshot();
    const bounds = faceLandmarks?.getFaceBoundsBox() ?? null;
    const anchorObject = faceLandmarks?.getAnchorObject() ?? null;

    if (!faceLandmarks || !bounds || !anchorObject || !faceSnapshot) {
      logger.info("Init", "Face landmarks unavailable for debug box", {
        sourceKey: this._avatar.sourceKey,
        sourceUrl: this._avatar.sourceUrl,
      });
      return;
    }

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bounds.getCenter(center);
    bounds.getSize(size);

    const width = clampExtent(size.x);
    const height = clampExtent(size.y);
    const depth = clampExtent(size.z);
    const maxExtent = Math.max(width, height, depth);
    const markerRadius = Math.max(MIN_MARKER_RADIUS, maxExtent * MARKER_SCALE);
    const boxGeometry = new THREE.BoxGeometry(width, height, depth);
    const edgeGeometry = new THREE.EdgesGeometry(boxGeometry);
    boxGeometry.dispose();

    const edgeMaterial = new THREE.LineBasicMaterial({
      color: DEBUG_COLOR,
      depthTest: false,
      transparent: true,
      opacity: EDGE_OPACITY,
      toneMapped: false,
    });
    const edges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edges.name = "AvatarFaceDebugBoxEdges";
    edges.renderOrder = 1000;
    edges.frustumCulled = false;

    const helper = new THREE.Group();
    helper.name = "AvatarFaceDebugOverlay";
    helper.position.copy(center);
    helper.visible = false;
    helper.renderOrder = 1000;
    helper.frustumCulled = false;
    helper.add(edges);
    helper.add(
      this._createProjectedEyeDebug(
        faceSnapshot.eyes.left,
        LEFT_EYE_COLOR,
        markerRadius,
        center,
      ),
    );
    helper.add(
      this._createProjectedEyeDebug(
        faceSnapshot.eyes.right,
        RIGHT_EYE_COLOR,
        markerRadius,
        center,
      ),
    );
    helper.add(
      this._createProjectedMouthDebug({
        mouthAnchor:
          faceTextureAnchors?.status === "ready"
            ? faceTextureAnchors.anchors.mouth.center
            : null,
        color: MOUTH_COLOR,
        markerRadius,
        boxCenter: center,
        frontZLocal: faceSnapshot.frontZLocal,
      }),
    );

    anchorObject.add(helper);

    this._helper = helper;

    logger.info("Init", "Attached face debug box", {
      bindingKey: faceSnapshot.faceBindingKey,
      materialName: faceSnapshot.faceMaterialName,
      anchorName: anchorObject.name || anchorObject.type,
      anchorType: anchorObject.type,
      width,
      height,
      depth,
    });
  }

  private _createProjectedEyeDebug(
    eye: AvatarFaceEyeLandmarkSnapshot | null,
    color: number,
    markerRadius: number,
    boxCenter: THREE.Vector3,
  ): THREE.Object3D {
    const group = new THREE.Group();
    if (!eye) return group;

    const center = toVector3(eye.centerLocal).sub(boxCenter);
    const projected = toVector3(eye.projectedFrontLocal).sub(boxCenter);

    const guideGeometry = new THREE.BufferGeometry().setFromPoints([
      center,
      projected,
    ]);
    const guideMaterial = new THREE.LineBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: GUIDE_OPACITY,
      toneMapped: false,
    });
    const guideLine = new THREE.Line(guideGeometry, guideMaterial);
    guideLine.renderOrder = 1001;
    guideLine.frustumCulled = false;
    group.add(guideLine);

    const centerMarker = this._createMarker(center, color, markerRadius * 0.7);
    centerMarker.name = `${eye.bindingKey}:center`;
    group.add(centerMarker);

    const projectedMarker = this._createMarker(projected, color, markerRadius);
    projectedMarker.name = `${eye.bindingKey}:projected`;
    group.add(projectedMarker);

    return group;
  }

  private _createProjectedMouthDebug(args: {
    mouthAnchor: AvatarFaceTextureAnchorSnapshot | null;
    color: number;
    markerRadius: number;
    boxCenter: THREE.Vector3;
    frontZLocal: number | null;
  }): THREE.Object3D {
    const group = new THREE.Group();
    if (!args.mouthAnchor) return group;

    const center = toVector3(args.mouthAnchor.localPoint).sub(args.boxCenter);
    const centerMarker = this._createMarker(
      center,
      args.color,
      args.markerRadius * 0.7,
    );
    centerMarker.name = "mouth:center";
    group.add(centerMarker);

    if (args.frontZLocal === null) {
      return group;
    }

    const projected = toVector3(args.mouthAnchor.localPoint)
      .lerp(
        new THREE.Vector3(
          args.mouthAnchor.localPoint.x,
          args.mouthAnchor.localPoint.y,
          args.frontZLocal,
        ),
        MOUTH_HOVER_SURFACE_LERP,
      )
      .sub(args.boxCenter);
    const guideGeometry = new THREE.BufferGeometry().setFromPoints([
      center,
      projected,
    ]);
    const guideMaterial = new THREE.LineBasicMaterial({
      color: args.color,
      depthTest: false,
      transparent: true,
      opacity: GUIDE_OPACITY,
      toneMapped: false,
    });
    const guideLine = new THREE.Line(guideGeometry, guideMaterial);
    guideLine.renderOrder = 1001;
    guideLine.frustumCulled = false;
    group.add(guideLine);

    const projectedMarker = this._createMarker(
      projected,
      args.color,
      args.markerRadius,
    );
    projectedMarker.name = "mouth:projected";
    group.add(projectedMarker);

    return group;
  }

  private _createMarker(
    position: THREE.Vector3,
    color: number,
    radius: number,
  ): THREE.Mesh {
    const geometry = new THREE.OctahedronGeometry(radius);
    const material = new THREE.MeshBasicMaterial({
      color,
      depthTest: false,
      transparent: true,
      opacity: 0.95,
      toneMapped: false,
    });
    const marker = new THREE.Mesh(geometry, material);
    marker.position.copy(position);
    marker.renderOrder = 1002;
    marker.frustumCulled = false;
    return marker;
  }
}
