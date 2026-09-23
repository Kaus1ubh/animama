import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import {
  clampPoseCreatorClipTime,
  snapPoseCreatorClipTime,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import type { ActionComponentType } from "./actionDependencies";

import {
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
} from "@/ui/content-creator/creatorTimelineGeometry";
export {
  TRACK_LABEL_RAIL_PX,
  TRACK_RIGHT_INSET_PX,
} from "@/ui/content-creator/creatorTimelineGeometry";
export type CatalogDragItem =
  | { kind: "pose"; pose: PyPose }
  | {
      kind: "effect";
      item: PyCatalogViewItem;
      contentType: ActionComponentType;
    };
export type TimelineDropLane =
  | "pose"
  | "avatar_vfx"
  | "scene_vfx"
  | "particle_vfx"
  | "sfx";
export type TimelineDropPreview = {
  time: number;
  lane: TimelineDropLane;
  replacesPose: boolean;
};
export type TimelinePoint = { x: number; y: number };
type TrackRect = { left: number; top: number; width: number; height: number };

export function catalogDragName(item: CatalogDragItem): string {
  return item.kind === "pose" ? item.pose.name : item.item.name;
}

export function catalogDropLane(item: CatalogDragItem): TimelineDropLane {
  if (item.kind === "pose") return "pose";
  const lanes: Record<ActionComponentType, TimelineDropLane> = {
    avatar_effect: "avatar_vfx",
    scene_effect: "scene_vfx",
    particle_effect: "particle_vfx",
    sound_effect: "sfx",
  };
  return lanes[item.contentType];
}

/** Shared geometry for scrubbing and catalog drops; the label rail is not time. */
export function timelinePointerTime(
  clientX: number,
  rect: TrackRect,
  duration: number,
): number {
  const width = Math.max(
    1,
    rect.width - TRACK_LABEL_RAIL_PX - TRACK_RIGHT_INSET_PX,
  );
  return (
    Math.min(
      1,
      Math.max(0, (clientX - rect.left - TRACK_LABEL_RAIL_PX) / width),
    ) * duration
  );
}

/** Resolve once by the same rules for both the preview and final release. */
export function resolveTimelineDropTime(
  point: TimelinePoint,
  rect: TrackRect,
  duration: number,
  snap: boolean,
  interval: number,
): number | null {
  if (
    rect.width <= TRACK_LABEL_RAIL_PX + TRACK_RIGHT_INSET_PX ||
    rect.height <= 0 ||
    point.x < rect.left + TRACK_LABEL_RAIL_PX ||
    point.x > rect.left + rect.width - TRACK_RIGHT_INSET_PX ||
    point.y < rect.top ||
    point.y > rect.top + rect.height
  )
    return null;
  const time = timelinePointerTime(point.x, rect, duration);
  return snap
    ? snapPoseCreatorClipTime(time, duration, interval)
    : clampPoseCreatorClipTime(time, duration);
}
