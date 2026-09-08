import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import {
  parsePlaybackObservation,
  waitForPlayingOutput,
} from "./playback-observation.ts";

function validObservation() {
  return {
    version: 1,
    surface: "library-dock",
    target: {
      kind: "animation",
      runtimeId: "being_cocky",
      status: "playing",
    },
    motion: {
      vrma: [
        {
          runtimeId: "being_cocky",
          active: true,
          playheadSec: 0.2,
          durationSec: 2,
          weight: 1,
        },
      ],
      poseClip: null,
      reactionClip: null,
    },
    expressions: {},
    effects: { particle: [], avatar: [], scene: [] },
    diagnostics: [],
  };
}

test("accepts a valid version-one observation", () => {
  assert.deepEqual(
    parsePlaybackObservation(validObservation()),
    validObservation(),
  );
});

test("accepts the shared creator-stage surface without a new target kind", () => {
  const observation = {
    ...validObservation(),
    surface: "creator-stage",
    target: {
      kind: "anima_pose_clip",
      runtimeId: "new-reaction",
      status: "stopped",
    },
  };

  assert.deepEqual(parsePlaybackObservation(observation), observation);
});

test("rejects an unknown schema version with a harness-specific error", () => {
  assert.throws(
    () => parsePlaybackObservation({ ...validObservation(), version: 2 }),
    /Unsupported playback observation schema version 2/,
  );
});

test("rejects malformed temporal channels before an assertion can time out", () => {
  const observation = validObservation();
  observation.motion.vrma[0]!.playheadSec = Number.NaN;
  assert.throws(
    () => parsePlaybackObservation(observation),
    /motion\.vrma\[0\]\.playheadSec must be a finite number/,
  );
});

/** Emulate only output-text mutations; no browser or runtime state is involved. */
function mockOutputObserver(t: TestContext, source: string) {
  const previous = Object.getOwnPropertyDescriptor(
    globalThis,
    "MutationObserver",
  );
  let read: (() => void) | undefined;
  let observing = false;
  const output = { textContent: source } as HTMLElement;
  Object.defineProperty(globalThis, "MutationObserver", {
    configurable: true,
    value: class {
      constructor(callback: () => void) {
        read = callback;
      }
      observe() {
        observing = true;
      }
      disconnect() {
        observing = false;
      }
    },
  });
  t.after(() => {
    if (previous)
      Object.defineProperty(globalThis, "MutationObserver", previous);
    else Reflect.deleteProperty(globalThis, "MutationObserver");
  });
  return {
    output,
    isObserving: () => observing,
    publish(value: unknown) {
      output.textContent = JSON.stringify(value);
      if (observing) read?.();
    },
  };
}

test("pre-armed readiness retains the first Playing update and disconnects", async (t) => {
  const loading = validObservation();
  loading.target.status = "loading";
  const mock = mockOutputObserver(t, JSON.stringify(loading));
  const pending = waitForPlayingOutput(mock.output, {
    expectedTarget: { kind: "animation", runtimeId: "being_cocky" },
    timeoutMs: 1_000,
  });
  assert.equal(mock.isObserving(), true);
  mock.publish({ ...validObservation(), expressions: { happy: 1 } });
  mock.publish({ ...validObservation(), expressions: { happy: 0 } });

  assert.equal(JSON.parse(await pending).expressions.happy, 1);
  assert.equal(mock.isObserving(), false);
});

test("readiness returns invalid payloads for validation and times out cleanly", async (t) => {
  const mock = mockOutputObserver(t, "not-json");
  const args = {
    expectedTarget: { kind: "animation" as const, runtimeId: "being_cocky" },
    timeoutMs: 10,
  };
  assert.equal(await waitForPlayingOutput(mock.output, args), "not-json");
  assert.equal(mock.isObserving(), false);

  const stopped = validObservation();
  stopped.target.status = "stopped";
  mock.publish(stopped);
  await assert.rejects(
    waitForPlayingOutput(mock.output, args),
    /last status was stopped/,
  );
  assert.equal(mock.isObserving(), false);
});

test("readiness can arm before the dock is inserted without a second browser call", async (t) => {
  const mock = mockOutputObserver(t, "");
  const outputs: HTMLElement[] = [];
  Object.defineProperty(mock.output, "querySelectorAll", {
    value: () => outputs,
  });
  const pending = waitForPlayingOutput(mock.output, {
    expectedTarget: { kind: "animation", runtimeId: "being_cocky" },
    surfaceKind: "library-dock",
    timeoutMs: 1_000,
  });
  assert.equal(mock.isObserving(), true);
  outputs.push({
    textContent: JSON.stringify(validObservation()),
  } as HTMLElement);
  mock.publish(null);

  assert.equal(JSON.parse(await pending).target.status, "playing");
  assert.equal(mock.isObserving(), false);
});
