import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  BIG_HEAD_SHARE,
  bodyHeightFromReference,
  headSized,
  measureAvatarProportions,
  measureHeadBounds,
  NEUTRAL_AVATAR_PROPORTIONS,
  REFERENCE_FACE_SIZE,
  REFERENCE_AVATAR_BODY,
  REFERENCE_HEAD_SIZE,
  setAvatarFaceSize,
  torsoSizeScale,
} from "./avatarProportions";
import {
  VRM0_FIXTURE_ID,
  type TestAvatarId,
} from "./motion-authoring/testing/includedAvatars";
import { loadedTestAvatar } from "./testing/loadedTestAvatar";
import { loadWholeBodyAvatar } from "./testing/wholeBodyVrm";

/*
 * Head art, contacts and framing follow a face that outgrows adult
 * proportions; the Included Avatars keep exactly today's placement, and
 * accessories the head mesh carries do not count.
 */

const INCLUDED: readonly TestAvatarId[] = [
  "Andrew",
  "AvatarSample_A_1_New",
  VRM0_FIXTURE_ID,
];

describe("Avatar proportions", () => {
  it.each(INCLUDED)("keeps body-sized placement on %s exactly", async (id) => {
    const avatar = await loadedTestAvatar(id);
    const proportions = measureAvatarProportions(avatar.vrm);
    expect(proportions.measuredFrom).toBe("face");
    // Their faces measure about the reference size.
    expect(proportions.headSize).toBeGreaterThan(0.21);
    expect(proportions.headSize).toBeLessThan(0.23);
    expect(proportions.bigHead).toBe(0);
    expect(headSized(proportions, 0.123, 9)).toBe(0.123);
    expect(avatar.getHeadFramingScale()).toBe(1);
    expect(avatar.getBodyFramingScale()).toBe(1);
    // Nothing reads the head box or body landmarks on adult proportions, so
    // load skips them.
    expect(proportions.headBox).toBeNull();
    expect(proportions.body).toBeNull();
  });

  it("keeps body-sized placement on an adult-proportioned synthetic Avatar", async () => {
    const avatar = await loadWholeBodyAvatar();
    const proportions = measureAvatarProportions(avatar.vrm);
    // The face: 0.3 m high, 0.2 m wide.
    expect(proportions.measuredFrom).toBe("face");
    expect(proportions.headSize).toBeCloseTo(0.3, 3);
    expect(proportions.bigHead).toBe(0);
    expect(avatar.getHeadFramingScale()).toBe(1);
  });

  it("leaves a hat the head mesh carries out of the head's size", async () => {
    const avatar = await loadWholeBodyAvatar({ hat: 0.4 });
    const proportions = measureAvatarProportions(avatar.vrm);
    // The face alone decides: adult proportions, as without the hat.
    expect(proportions.headSize).toBeCloseTo(0.3, 3);
    expect(proportions.bigHead).toBe(0);
    // The head box, which counts the hat, would have taken it for a big head.
    setAvatarFaceSize(avatar.vrm!, null);
    const byBox = measureAvatarProportions(avatar.vrm);
    expect(byBox.measuredFrom).toBe("head_box");
    const box = byBox.headBox!;
    expect(box.max.y - box.min.y).toBeGreaterThan(0.7);
    expect(byBox.bigHead).toBe(1);
  });

  it("measures a head box first read after load from the model as loaded", async () => {
    const avatar = await loadWholeBodyAvatar({ hat: 0.4 });
    const vrm = avatar.vrm!;
    const head = vrm.humanoid.getNormalizedBoneNode("head")!;
    const atLoad = measureHeadBounds(vrm, head)!;
    expect(measureAvatarProportions(vrm).headBox).toBeNull();
    // Later, effects hang art under the head and hide a mesh...
    const art = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    art.position.set(0, 1, 0);
    vrm.humanoid.getRawBoneNode("head")!.add(art);
    const body = vrm.scene.getObjectsByProperty("isSkinnedMesh", true)[0]!;
    body.visible = false;
    // ...before a face correction leaves the head box to stand in.
    setAvatarFaceSize(vrm, null);
    const late = measureAvatarProportions(vrm).headBox!;
    expect(late.min.toArray()).toEqual(atLoad.min.toArray());
    expect(late.max.toArray()).toEqual(atLoad.max.toArray());
  });

  it("places by a chibi face's own size", async () => {
    // The head scaled twice about the head bone: about twice the adult share.
    const avatar = await loadWholeBodyAvatar({ headScale: 2 });
    const proportions = measureAvatarProportions(avatar.vrm);
    // The face, 0.6 m high and 0.4 m wide; the head box adds the fringe.
    expect(proportions.measuredFrom).toBe("face");
    expect(proportions.headSize).toBeCloseTo(0.6, 3);
    const share = proportions.headSize / (proportions.avatarScale * 1.25);
    expect(share).toBeGreaterThan(BIG_HEAD_SHARE.full);
    expect(proportions.bigHead).toBe(1);
    expect(proportions.headScale).toBeCloseTo(0.6 / REFERENCE_FACE_SIZE, 3);
    expect(avatar.getHeadFramingScale()).toBe(proportions.headScale);
    expect(proportions.headBox!.max.y).toBeCloseTo(0.52, 3);
  });

  it("measures the head box in place of a face that was not found", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: 2 });
    setAvatarFaceSize(avatar.vrm!, null);
    const proportions = measureAvatarProportions(avatar.vrm);
    expect(proportions.measuredFrom).toBe("head_box");
    const box = proportions.headBox!;
    expect(proportions.headSize).toBeCloseTo(box.max.y - box.min.y, 5);
    expect(proportions.headScale).toBeCloseTo(
      proportions.headSize / REFERENCE_HEAD_SIZE,
      5,
    );
  });

  it("measures once per model and face", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: 2 });
    const first = measureAvatarProportions(avatar.vrm);
    expect(measureAvatarProportions(avatar.vrm)).toBe(first);
    // A face measured again (a face part correction) is read afresh.
    await avatar.setFacePartCorrections(null);
    expect(measureAvatarProportions(avatar.vrm)).not.toBe(first);
    expect(measureAvatarProportions(avatar.vrm)).toEqual(first);
  });

  it("frames a small adult-proportioned Avatar by its size", async () => {
    // Head and body at half size: `avatarScale` 0.58, under the band.
    const avatar = await loadWholeBodyAvatar({
      headScale: 0.5,
      bodyScale: 0.5,
    });
    const proportions = measureAvatarProportions(avatar.vrm);
    expect(proportions.bigHead).toBe(0);
    expect(proportions.bodyScale).toBeLessThan(0.7);
    expect(avatar.getHeadFramingScale()).toBe(proportions.bodyScale);
    expect(avatar.getBodyFramingScale()).toBe(proportions.bodyScale);
  });

  it("measures a chibi body's landmarks and limbs", async () => {
    // A twice-sized head on a body 0.4 times the adult's.
    const avatar = await loadWholeBodyAvatar({ headScale: 2, bodyScale: 0.4 });
    const proportions = measureAvatarProportions(avatar.vrm);
    expect(proportions.bigHead).toBe(1);
    const body = proportions.body!;
    // Synthetic bones (m below the head bone at full size), times 0.4.
    expect(body.heights.neck).toBeCloseTo(-0.1 * 0.4);
    expect(body.heights.shoulders).toBeCloseTo(-0.15 * 0.4);
    expect(body.heights.chest).toBeCloseTo(-0.35 * 0.4);
    expect(body.heights.spine).toBeCloseTo(-0.5 * 0.4);
    expect(body.heights.hips).toBeCloseTo(-0.6 * 0.4);
    expect(body.heights.feet).toBeCloseTo(-1.45 * 0.4);
    expect(body.heights.ground).toBeCloseTo(-1.5 * 0.4);
    // No upper chest bone.
    expect(body.heights.upperChest).toBeUndefined();
    expect(body.torsoWidth).toBeCloseTo((0.18 + 0.1) * 0.4);
    expect(body.armLength).toBeCloseTo(0.5 * 0.4);
    // Hips to neck 0.5 m and torso width 0.28 m at full size, times 0.4.
    expect(torsoSizeScale(body)).toBeCloseTo(
      Math.sqrt(((0.5 * 0.4) / 0.4) * ((0.28 * 0.4) / 0.178)),
    );
    expect(body.legLength).toBeCloseTo(0.8 * 0.4);
    // The whole body framed: the top of the head, over the Included
    // Avatars' share of it above the head bone.
    const headY = proportions.avatarScale * 1.25;
    const top = headY + proportions.headBox!.max.y;
    expect(avatar.getBodyFramingScale()).toBeCloseTo(top / 1.15 / 1.25);
  });

  it("places a height authored on the Included Avatars among a chibi's landmarks", async () => {
    const avatar = await loadWholeBodyAvatar({ headScale: 2, bodyScale: 0.4 });
    const proportions = measureAvatarProportions(avatar.vrm);
    const { heights } = REFERENCE_AVATAR_BODY;
    const body = proportions.body!.heights;
    // Landmark to landmark.
    expect(bodyHeightFromReference(proportions, heights.chest)).toBeCloseTo(
      body.chest!,
    );
    expect(bodyHeightFromReference(proportions, heights.ground)).toBeCloseTo(
      body.ground!,
    );
    // Between two, the same share of the way.
    const between = (heights.shoulders + heights.chest) / 2;
    expect(bodyHeightFromReference(proportions, between)).toBeCloseTo(
      (body.shoulders! + body.chest!) / 2,
    );
    // Above the head bone by the head's size; under the ground by the body's.
    expect(bodyHeightFromReference(proportions, 0.2)).toBeCloseTo(
      0.2 * proportions.headScale,
    );
    expect(
      bodyHeightFromReference(proportions, heights.ground - 0.1),
    ).toBeCloseTo(body.ground! - 0.1 * proportions.bodyScale);
  });

  it("blends between adult and big-headed proportions on the ramp", () => {
    const halfway = { ...NEUTRAL_AVATAR_PROPORTIONS, bigHead: 0.5 };
    expect(headSized(halfway, 1, 3)).toBe(2);
    expect(headSized(NEUTRAL_AVATAR_PROPORTIONS, 1, 3)).toBe(1);
    expect(measureAvatarProportions(null)).toBe(NEUTRAL_AVATAR_PROPORTIONS);
  });
});
