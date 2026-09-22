"use client";

import { TransformControls } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
} from "react";
import {
  SphereGeometry,
  type BufferGeometry,
  type Color,
  type Line,
  type LineBasicMaterial,
  type Material,
  type Object3D,
} from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

import type { Avatar } from "@/lib/avatar";
import type { PoseCreatorQuaternionTuple } from "@/stores/pose-creator-store";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";
import {
  captureBoneBaseQuaternion,
  getPoseCreatorNormalizedBoneNode,
  readPoseCreatorBoneRotationDegrees,
} from "./poseCreatorAuthoring";
import { shouldShowPoseCreatorBoneGizmo } from "./poseCreatorBoneGizmoVisibility";
import {
  beginPoseCreatorDraftUndoGroup,
  endPoseCreatorDraftUndoGroup,
  type PoseCreatorDraftUndoGroup,
} from "./poseCreatorUndo";
import { usePoseCreatorBoneRotation } from "./usePoseCreatorBoneRotation";

type PoseCreatorBoneGizmoProps = {
  avatar: Avatar | null;
};

type BoneDragSnapshot = {
  boneName: string;
  node: Object3D;
  baseQuaternion: PoseCreatorQuaternionTuple;
};

const ROTATION_HANDLE_WIDTH_PX = 2;
const ROTATION_HANDLE_HOVER_WIDTH_PX = 2.25;
const ROTATION_HANDLE_ACTIVE_WIDTH_PX = 2.5;
const VIEW_AXIS_OPACITY = 0.65;
const INACTIVE_HANDLE_HOVER_OPACITY = 0.18;
const FREE_ROTATION_PICKER_RADIUS = 0.85;
const SPECIFIC_ROTATION_HANDLE_NAMES = new Set(["X", "Y", "Z", "E", "XYZE"]);

type ColoredHandleMaterial = Material & {
  color: Color;
  opacity: number;
};

type RenderableHandle = Object3D & {
  material: ColoredHandleMaterial | ColoredHandleMaterial[];
};

type RotationPicker = Object3D & {
  geometry: BufferGeometry;
};

type TransformControlsGizmoInternals = {
  axis: string | null;
  dragging: boolean;
  gizmo: {
    gizmo: {
      rotate: Object3D;
    };
    picker: {
      rotate: Object3D;
    };
  };
};

/**
 * Three's stock rotation handles use WebGL lines whose width is fixed to one
 * pixel on most browsers. Swap those visible lines for wide-line meshes and
 * enlarge the free-rotation picker so the center has no misleading dead band.
 */
function installPoseCreatorRotationHandles(
  controls: ComponentRef<typeof TransformControls>,
) {
  const internals = controls as unknown as TransformControlsGizmoInternals;
  const { rotate } = internals.gizmo.gizmo;
  const freeRotationPicker = internals.gizmo.picker.rotate.children.find(
    (child): child is RotationPicker =>
      child.name === "XYZE" && "geometry" in child,
  );
  const originalFreeRotationPickerGeometry = freeRotationPicker?.geometry;
  if (freeRotationPicker) {
    freeRotationPicker.geometry = new SphereGeometry(
      FREE_ROTATION_PICKER_RADIUS,
      10,
      8,
    );
  }
  const replacements: Array<{ original: Line; wide: Line2 }> = [];
  const styledHandles: Array<{
    handle: RenderableHandle;
    onBeforeRender: RenderableHandle["onBeforeRender"];
  }> = [];

  for (const child of [...rotate.children]) {
    if (!("isLine" in child) || !child.isLine) continue;

    const original = child as Line<BufferGeometry, LineBasicMaterial>;
    const positions = original.geometry.getAttribute("position");
    const geometry = new LineGeometry();
    geometry.setPositions(Array.from(positions.array));

    const originalMaterial = Array.isArray(original.material)
      ? original.material[0]
      : original.material;
    const material = new LineMaterial({
      color: originalMaterial.color.getHex(),
      depthTest: false,
      depthWrite: false,
      linewidth: ROTATION_HANDLE_WIDTH_PX,
      opacity: originalMaterial.opacity,
      transparent: true,
    });
    const wide = new Line2(geometry, material);
    wide.name = original.name;
    wide.renderOrder = original.renderOrder;
    wide.frustumCulled = false;

    rotate.remove(original);
    rotate.add(wide);
    replacements.push({ original, wide });
  }

  for (const child of rotate.children) {
    if (!("material" in child)) continue;

    const handle = child as RenderableHandle;
    const materials = Array.isArray(handle.material)
      ? handle.material
      : [handle.material];
    const baseMaterials = materials.map((material) => ({
      color: material.color.clone(),
      opacity: handle.name === "E" ? VIEW_AXIS_OPACITY : material.opacity,
    }));
    const onBeforeRender = handle.onBeforeRender.bind(handle);

    handle.onBeforeRender = (...args) => {
      // Line2 updates its viewport resolution here. Preserve that callback or
      // a screen-space line can expand to cover the canvas.
      onBeforeRender(...args);

      const currentHandleName =
        internals.axis === "XYZ" ? "XYZE" : internals.axis;
      const isCurrentHandle = currentHandleName === handle.name;
      const isNeutralHover =
        !internals.dragging &&
        !SPECIFIC_ROTATION_HANDLE_NAMES.has(internals.axis ?? "");

      materials.forEach((material, index) => {
        const base = baseMaterials[index];
        material.color.copy(base.color);
        material.opacity = isNeutralHover
          ? base.opacity
          : isCurrentHandle
            ? 1
            : base.opacity * INACTIVE_HANDLE_HOVER_OPACITY;
      });

      if (handle instanceof Line2) {
        const material = handle.material as LineMaterial;
        material.linewidth = isCurrentHandle
          ? internals.dragging
            ? ROTATION_HANDLE_ACTIVE_WIDTH_PX
            : ROTATION_HANDLE_HOVER_WIDTH_PX
          : ROTATION_HANDLE_WIDTH_PX;
      }
    };
    styledHandles.push({ handle, onBeforeRender });
  }

  return () => {
    if (freeRotationPicker && originalFreeRotationPickerGeometry) {
      freeRotationPicker.geometry.dispose();
      freeRotationPicker.geometry = originalFreeRotationPickerGeometry;
    }
    for (const { handle, onBeforeRender } of styledHandles) {
      handle.onBeforeRender = onBeforeRender;
    }
    for (const { original, wide } of replacements) {
      rotate.remove(wide);
      wide.geometry.dispose();
      wide.material.dispose();
      rotate.add(original);
    }
  };
}

/**
 * Attaches Drei's local rotation control to the selected normalized VRM bone
 * and synchronizes every drag back into the serializable pose draft.
 */
export function PoseCreatorBoneGizmo({ avatar }: PoseCreatorBoneGizmoProps) {
  const viewportWidth = useThree((state) => state.size.width);
  const authoringMode = usePoseCreatorStore((state) => state.authoringMode);
  const selectedBone = usePoseCreatorStore((state) => state.selectedBone);
  const boneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.boneHelperNodesVisible,
  );
  const clipInlineEdit = usePoseCreatorStore((state) => state.clipInlineEdit);
  const clipPlaybackPlaying = usePoseCreatorStore(
    (state) => state.clipPlaybackPlaying,
  );
  const { updateSelectedBoneRotation } = usePoseCreatorBoneRotation();
  const controlsRef = useRef<ComponentRef<typeof TransformControls> | null>(
    null,
  );
  const dragSnapshotRef = useRef<BoneDragSnapshot | null>(null);
  const undoGroupRef = useRef<PoseCreatorDraftUndoGroup | null>(null);
  const selectedNode = useMemo(
    () =>
      selectedBone
        ? getPoseCreatorNormalizedBoneNode(avatar, selectedBone)
        : null,
    [avatar, selectedBone],
  );
  const visible = shouldShowPoseCreatorBoneGizmo({
    boneHelperNodesVisible,
    authoringMode,
    hasClipInlineEdit: Boolean(clipInlineEdit),
    clipPlaybackPlaying,
  });

  useEffect(() => {
    const group = undoGroupRef.current;
    if (group) endPoseCreatorDraftUndoGroup(group);
    undoGroupRef.current = null;
    dragSnapshotRef.current = null;
  }, [avatar, selectedBone, visible]);

  useEffect(
    () => () => {
      const group = undoGroupRef.current;
      if (group) endPoseCreatorDraftUndoGroup(group);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!visible || !selectedNode || !controlsRef.current) return;
    return installPoseCreatorRotationHandles(controlsRef.current);
  }, [selectedNode, visible]);

  const beginDrag = useCallback(() => {
    const state = usePoseCreatorStore.getState();
    const boneName = state.selectedBone;
    if (!avatar || !boneName || !selectedNode) return;

    // TransformControls mutates the node before objectChange. Capture the
    // inherited rotation now so the first gizmo edit cannot become its own base.
    const baseQuaternion =
      state.boneDrafts[boneName]?.baseQuaternion ??
      captureBoneBaseQuaternion(avatar, boneName);
    if (!baseQuaternion) return;

    dragSnapshotRef.current = {
      boneName,
      node: selectedNode,
      baseQuaternion: [...baseQuaternion] as PoseCreatorQuaternionTuple,
    };
    undoGroupRef.current = beginPoseCreatorDraftUndoGroup();
  }, [avatar, selectedNode]);

  const syncDragToDraft = useCallback(() => {
    const snapshot = dragSnapshotRef.current;
    const state = usePoseCreatorStore.getState();
    if (
      !snapshot ||
      !avatar ||
      state.selectedBone !== snapshot.boneName ||
      selectedNode !== snapshot.node
    ) {
      return;
    }

    const rotationDegrees = readPoseCreatorBoneRotationDegrees(
      avatar,
      snapshot.boneName,
    );
    if (!rotationDegrees) return;
    updateSelectedBoneRotation(rotationDegrees, {
      baseQuaternion: snapshot.baseQuaternion,
    });
  }, [avatar, selectedNode, updateSelectedBoneRotation]);

  const finishDrag = useCallback(() => {
    syncDragToDraft();
    dragSnapshotRef.current = null;
    const group = undoGroupRef.current;
    undoGroupRef.current = null;
    if (group) endPoseCreatorDraftUndoGroup(group);
  }, [syncDragToDraft]);

  if (!visible || !selectedNode) return null;

  return (
    <TransformControls
      ref={controlsRef}
      enabled
      mode="rotate"
      object={selectedNode}
      onMouseDown={beginDrag}
      onMouseUp={finishDrag}
      onObjectChange={syncDragToDraft}
      showX
      showY
      showZ
      size={viewportWidth < 640 ? 0.86 : viewportWidth < 1024 ? 0.78 : 0.72}
      space="local"
    />
  );
}
