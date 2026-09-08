import { describe, expect, it } from "vitest";

import { idleStyleSpec, type IdleStyleDocument } from "./idleStyleDocument";

function file(name: string) {
  return new File(["vrma"], name, { type: "model/gltf-binary" });
}

describe("idleStyleSpec", () => {
  it("keeps direct animation ordinals and sparse emotion pools", () => {
    const document: IdleStyleDocument = {
      animations: [
        {
          animationId: "neutral",
          name: "Breathing",
          file: file("neutral.vrma"),
        },
        {
          animationId: "angry",
          name: "Angry Stance",
          file: file("angry.vrma"),
        },
        { animationId: "sad", name: "Downcast", file: file("sad.vrma") },
      ],
      defaultPool: ["neutral"],
      emotionPools: { anger: ["angry"], sadness: ["sad"] },
      crossFadeSeconds: 0.35,
    };
    const spec = idleStyleSpec(document);
    expect(spec.animations.map((row) => row.ordinal)).toEqual([1, 2, 3]);
    expect(spec.default_pool).toEqual(["neutral"]);
    expect(spec.emotion_pools).toMatchObject({
      anger: ["angry"],
      sadness: ["sad"],
    });
  });

  it("rejects a foreign pool animation", () => {
    expect(() =>
      idleStyleSpec({
        animations: [
          { animationId: "neutral", name: "Neutral", file: file("n.vrma") },
        ],
        defaultPool: ["missing"],
        emotionPools: {},
        crossFadeSeconds: 0.35,
      }),
    ).toThrow("unknown animation");
  });

  it("rejects duplicate IDs and unnamed animations", () => {
    const shared = file("same.vrma");
    expect(() =>
      idleStyleSpec({
        animations: [
          { animationId: "same", name: "One", file: shared },
          { animationId: "same", name: "Two", file: shared },
        ],
        defaultPool: ["same"],
        emotionPools: {},
        crossFadeSeconds: 0.35,
      }),
    ).toThrow("unique");
    expect(() =>
      idleStyleSpec({
        animations: [{ animationId: "same", name: " ", file: shared }],
        defaultPool: ["same"],
        emotionPools: {},
        crossFadeSeconds: 0.35,
      }),
    ).toThrow("needs a name");
  });
});
