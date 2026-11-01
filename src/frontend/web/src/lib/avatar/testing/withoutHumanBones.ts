import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";

import { loadHeadlessVrm } from "../motion-authoring/headlessVrm";
import {
  readTestAvatarBytes,
  type TestAvatarId,
} from "../motion-authoring/testing/includedAvatars";
import { encodeGlb } from "./glb";

type VrmJson = {
  extensions?: {
    VRMC_vrm?: { humanoid: { humanBones: Record<string, unknown> } };
    VRM?: { humanoid: { humanBones: { bone: string; node: number }[] } };
  };
};

/** Bones to map to another bone's node before removing any (`withoutHumanBones`). */
export type HumanBoneMoves = Partial<
  Record<VRMHumanBoneName, VRMHumanBoneName>
>;

/**
 * A copy of a VRM file whose humanoid maps none of `bones`, as a model rigged
 * without them: the nodes and their skinning stay, but no humanoid bone
 * names them, so three-vrm builds the normalized rig without them (VRM 0
 * thumb names are VRM 1's, as the app reads them). `moves` first maps a bone
 * to another bone's node, for example `{ chest: "upperChest" }` with
 * `upperChest` removed: a rig whose only chest sits at upper-chest height.
 */
export function withoutHumanBones(
  bytes: ArrayBuffer,
  bones: readonly VRMHumanBoneName[],
  moves: HumanBoneMoves = {},
): ArrayBuffer {
  const view = new DataView(bytes);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  ) as VrmJson;
  const binStart = 20 + jsonLength;
  const bin =
    binStart < bytes.byteLength
      ? new Uint8Array(bytes, binStart + 8, view.getUint32(binStart, true))
      : undefined;
  const moved = Object.entries(moves) as [VRMHumanBoneName, VRMHumanBoneName][];
  const vrm1 = json.extensions?.VRMC_vrm?.humanoid.humanBones;
  if (vrm1) {
    for (const [bone, source] of moved) vrm1[bone] = vrm1[source];
    for (const bone of bones) delete vrm1[bone];
  }
  const vrm0 = json.extensions?.VRM?.humanoid;
  if (vrm0) {
    // VRM 0 names thumb segments one step further from the hand.
    const vrm0Name = (bone: string) =>
      bone
        .replace(/ThumbProximal$/, "ThumbIntermediate")
        .replace(/ThumbMetacarpal$/, "ThumbProximal");
    const entry = (bone: string) =>
      vrm0.humanBones.find((candidate) => candidate.bone === vrm0Name(bone));
    for (const [bone, source] of moved) entry(bone)!.node = entry(source)!.node;
    const names = new Set(bones.map(vrm0Name));
    vrm0.humanBones = vrm0.humanBones.filter((entry) => !names.has(entry.bone));
  }
  const glb = encodeGlb(json, bin);
  return glb.buffer.slice(
    glb.byteOffset,
    glb.byteOffset + glb.byteLength,
  ) as ArrayBuffer;
}

/** Every finger's distal segment, on both hands. */
export const DISTAL_FINGER_BONES: readonly VRMHumanBoneName[] = (
  ["left", "right"] as const
).flatMap((side) =>
  (["Thumb", "Index", "Middle", "Ring", "Little"] as const).map(
    (digit) => `${side}${digit}Distal` as VRMHumanBoneName,
  ),
);

/**
 * Load an Included Avatar (or the VRM 0 fixture) rigged without `bones`,
 * after `moves` (`withoutHumanBones`).
 */
export async function loadTestAvatarWithout(
  id: TestAvatarId,
  bones: readonly VRMHumanBoneName[],
  moves: HumanBoneMoves = {},
): Promise<VRM> {
  return loadHeadlessVrm(
    withoutHumanBones(await readTestAvatarBytes(id), bones, moves),
  );
}
