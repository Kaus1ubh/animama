import type { Avatar } from "@/lib/avatar";

type PoseCreatorFrameAvatar = Pick<
  Avatar,
  "vfxController" | "updateModel" | "particleVFXController"
>;

/** Advance only the render systems owned by the Pose Creator preview. */
export function updatePoseCreatorAvatarFrame(
  avatar: PoseCreatorFrameAvatar | null,
  delta: number,
): void {
  avatar?.vfxController?.update(delta);
  avatar?.updateModel(delta);
  avatar?.particleVFXController?.update(delta);
}
