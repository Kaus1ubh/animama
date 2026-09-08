import { describe, expect, it } from "vitest";

import { resolveAvatarPortraitFraming } from "./framing";

const HEAD = { x: 0, y: 1.6, z: 0 };

describe("resolveAvatarPortraitFraming", () => {
  it("centers a normal three-landmark face", () => {
    const framing = resolveAvatarPortraitFraming({
      head: HEAD,
      landmarks: [
        { x: -0.04, y: 1.63, z: 0.08 },
        { x: 0.04, y: 1.63, z: 0.08 },
        { x: 0, y: 1.54, z: 0.09 },
      ],
    });

    expect(framing.usedLandmarkCount).toBe(3);
    expect(framing.target.x).toBeCloseTo(0);
    expect(framing.target.y).toBeLessThan(HEAD.y);
    expect(framing.distance).toBeGreaterThanOrEqual(0.42);
    expect(framing.distance).toBeLessThan(0.65);
  });

  it.each([
    { label: "no landmarks", landmarks: [] },
    {
      label: "one missing landmark",
      landmarks: [{ x: -0.04, y: 1.63, z: 0.08 }],
    },
    {
      label: "points behind the camera",
      landmarks: [
        { x: -0.04, y: 1.63, z: 4, visible: false },
        { x: 0.04, y: 1.63, z: 4, visible: false },
      ],
    },
  ])("uses bounded head framing for $label", ({ landmarks }) => {
    const framing = resolveAvatarPortraitFraming({ head: HEAD, landmarks });
    expect(framing.faceSpan).toBeNull();
    expect(framing.distance).toBe(0.52);
    expect(framing.target).toEqual(HEAD);
  });

  it("clamps extreme hair or accessory landmark spans", () => {
    const framing = resolveAvatarPortraitFraming({
      head: HEAD,
      landmarks: [
        { x: -10, y: 10, z: 0 },
        { x: 10, y: -10, z: 0 },
      ],
    });
    expect(framing.distance).toBe(2.4);
    expect(framing.target.x).toBeCloseTo(0);
    expect(framing.target.y).toBeGreaterThanOrEqual(1.56);
  });

  it.each([
    { label: "short", head: { x: 0, y: 0.55, z: 0 } },
    { label: "tall", head: { x: 0, y: 2.4, z: 0 } },
  ])("keeps fallback framing head-relative for a $label model", ({ head }) => {
    const framing = resolveAvatarPortraitFraming({ head });
    expect(framing.cameraPosition.y).toBe(head.y);
    expect(framing.cameraPosition.z - head.z).toBeCloseTo(0.52);
  });

  it("ignores non-finite landmark points", () => {
    const framing = resolveAvatarPortraitFraming({
      head: HEAD,
      landmarks: [
        { x: Number.NaN, y: 1.6, z: 0 },
        { x: 0, y: 1.5, z: 0 },
      ],
    });
    expect(framing.faceSpan).toBeNull();
    expect(framing.usedLandmarkCount).toBe(1);
  });

  it("raises the fallback target from the head-bone origin toward the crown", () => {
    const framing = resolveAvatarPortraitFraming({
      head: HEAD,
      headTopY: 2,
    });
    expect(framing.target.y).toBeCloseTo(1.74);
    expect(framing.cameraPosition.y).toBeCloseTo(1.74);
    expect(framing.distance).toBeGreaterThan(0.52);
    expect(framing.distance).toBeLessThanOrEqual(0.78);
  });
});
