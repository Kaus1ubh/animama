import assert from "node:assert/strict";
import test from "node:test";
import { assertClip } from "./clips.mjs";

const metadata = {
    mutedProceduralLayers: [
        "breathing",
        "sway",
        "bounce",
        "headNod",
        "headSideTilt",
        "cursorLookAt",
        "emotionPosture",
    ],
    generator: { tool: "animama-animation", source: "wave.motion.json" },
    futureMetadata: { enabled: false, tags: ["reviewed"] },
};
const v2 = {
    schema: "animaPoseClip/2.0",
    role: "motion",
    duration: 1,
    ...metadata,
    beats: [
        { id: "a", time: 0 },
        { id: "b", time: 1 },
    ],
    expressions: {
        happy: [
            { beat: "a", v: 0 },
            { beat: "b", v: 0.75 },
        ],
    },
};
const events = [
    {
        id: "heart-burst",
        time: 0.4,
        kind: "particle_vfx",
        effectId: "heart-burst",
        duration: 0.2,
    },
];

test("the 2.0 clip format preserves metadata and normal motion endpoints", () => {
    assertClip(v2, "animaPoseClip/2.0", "normal");
    assert.throws(() =>
        assertClip(
            { ...v2, schema: "animaPoseClip/1.0" },
            "animaPoseClip/1.0",
            "normal",
        ),
    );
    assert.throws(() =>
        assertClip(
            { ...v2, schema: "animaPoseClip/3.0" },
            "animaPoseClip/3.0",
            "normal",
        ),
    );
    assert.throws(() =>
        assertClip(
            { ...v2, futureMetadata: {} },
            "animaPoseClip/2.0",
            "normal",
        ),
    );
    assert.throws(() =>
        assertClip(
            {
                ...v2,
                expressions: {
                    happy: [
                        { beat: "a", v: 0 },
                        { beat: "b", v: 0.5 },
                    ],
                },
            },
            "animaPoseClip/2.0",
            "normal",
        ),
    );
});

test("an effect-only clip retains the exact event and no motion tracks", () => {
    const effect = { ...v2, beats: [], expressions: undefined, events };
    assertClip(effect, "animaPoseClip/2.0", "effect-only");
    assert.throws(() =>
        assertClip(
            { ...effect, events: [{ ...events[0], duration: 0.3 }] },
            "animaPoseClip/2.0",
            "effect-only",
        ),
    );
    assert.throws(() =>
        assertClip(
            {
                ...effect,
                rotations: { hips: [{ beat: "a", q: [0, 0, 0, 1] }] },
            },
            "animaPoseClip/2.0",
            "effect-only",
        ),
    );
});
