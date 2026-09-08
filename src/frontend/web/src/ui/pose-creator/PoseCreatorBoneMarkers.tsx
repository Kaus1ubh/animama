"use client";

import { createPortal, useThree } from "@react-three/fiber";
import { VRMHumanBoneList, type VRMHumanBoneName } from "@pixiv/three-vrm";
import { Fragment, useMemo } from "react";
import type { Object3D } from "three";

import type { Avatar } from "@/lib/avatar";
import { usePoseCreatorStore } from "@/stores/pose-creator-store";

type PoseCreatorBoneMarker = {
  boneName: VRMHumanBoneName;
  node: Object3D;
};

type PoseCreatorBoneMarkersProps = {
  avatar: Avatar | null;
};

const SELECTED_MARKER_RADIUS = 0.0155;
const DEFAULT_MARKER_RADIUS = 0.0115;

function PoseCreatorBoneMarkerNode({
  boneName,
  isSelected,
  onSelect,
}: {
  boneName: VRMHumanBoneName;
  isSelected: boolean;
  onSelect: (boneName: string) => void;
}) {
  const viewportWidth = useThree((state) => state.size.width);
  const touchScale =
    viewportWidth < 640 ? 1.35 : viewportWidth < 1024 ? 1.18 : 1;
  const radius =
    (isSelected ? SELECTED_MARKER_RADIUS : DEFAULT_MARKER_RADIUS) * touchScale;

  return (
    <mesh
      name={`PoseCreatorBoneMarker:${boneName}`}
      renderOrder={1000}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(boneName);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
    >
      <sphereGeometry args={[radius, 16, 12]} />
      <meshBasicMaterial
        color={isSelected ? "#38bdf8" : "#f8fafc"}
        depthTest={false}
        depthWrite={false}
        opacity={isSelected ? 0.95 : 0.68}
        toneMapped={false}
        transparent
      />
    </mesh>
  );
}

export function PoseCreatorBoneMarkers({
  avatar,
}: PoseCreatorBoneMarkersProps) {
  const boneHelperNodesVisible = usePoseCreatorStore(
    (state) => state.boneHelperNodesVisible,
  );
  const selectedBone = usePoseCreatorStore((state) => state.selectedBone);
  const focusBone = usePoseCreatorStore((state) => state.focusBone);
  const markers = useMemo<PoseCreatorBoneMarker[]>(() => {
    const humanoid = avatar?.vrm?.humanoid;
    if (!humanoid) return [];

    return VRMHumanBoneList.flatMap((boneName) => {
      const node = humanoid.getNormalizedBoneNode(boneName);
      return node ? [{ boneName, node }] : [];
    });
  }, [avatar]);

  return boneHelperNodesVisible ? (
    <>
      {markers.map((marker) => (
        <Fragment key={marker.boneName}>
          {createPortal(
            <PoseCreatorBoneMarkerNode
              boneName={marker.boneName}
              isSelected={marker.boneName === selectedBone}
              onSelect={focusBone}
            />,
            marker.node,
          )}
        </Fragment>
      ))}
    </>
  ) : null;
}
