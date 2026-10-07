import { isDeepStrictEqual } from "node:util";

import { expect, type Page } from "playwright/test";

type JsonRecord = Record<string, unknown>;

export type ValidatedReactionClip = JsonRecord & {
  schema: "animaPoseClip/2.0";
  id: string;
  name: string;
  duration: number;
  beats: unknown[];
  expressions: JsonRecord;
};

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
}

function exactNumber(value: unknown, expected: number, label: string): void {
  const actual = finiteNumber(value, label);
  if (Math.abs(actual - expected) > 0.000_001) {
    throw new Error(`${label} must equal ${expected}; received ${actual}.`);
  }
}

function exactRecord(
  actual: JsonRecord,
  expected: JsonRecord,
  label: string,
): void {
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      `${label} must equal ${JSON.stringify(expected)}; received ${JSON.stringify(actual)}.`,
    );
  }
}

/** Derive the sole creator display name from the runner-owned timestamp ID. */
export function reactionNameFromRunId(runId: string): string {
  const match = /^run-(\d{10})$/.exec(runId);
  if (!match?.[1]) {
    throw new Error(
      `Reaction creator journey requires run-MMDDHHmmss; received ${runId}.`,
    );
  }
  return `react-${match[1]}`;
}

export async function setReactionPlayhead(
  page: Page,
  value: number,
): Promise<void> {
  const playhead = page.locator(
    'input[aria-label="Clip timeline playhead time"]:visible',
  );
  await expect(playhead).toHaveCount(1);
  await playhead.fill(String(value));
  await expect(playhead).toHaveValue(String(value));
}

async function setExpression(
  page: Page,
  expressionName: string,
  value: 0 | 1,
): Promise<void> {
  const slider = page
    .locator(`[aria-label="Expression ${expressionName}"]:visible`)
    .getByRole("slider");
  await expect(slider).toHaveCount(1);
  await expect(slider).toBeEnabled();
  await slider.focus();
  await slider.press(value === 1 ? "End" : "Home");
  await expect(slider).toHaveAttribute("aria-valuenow", String(value));
}

async function expectKeyframes(page: Page, count: number): Promise<void> {
  await expect(
    page.getByRole("button", { name: / keyframe at \d+\.\d{2}s$/ }),
  ).toHaveCount(count);
}

/** Author the two requested expression landmarks through visible controls. */
export async function authorHappyToAngryReaction(page: Page): Promise<void> {
  await setReactionPlayhead(page, 0);
  await setExpression(page, "happy", 1);
  await expectKeyframes(page, 1);
  await expect(
    page.getByRole("button", { name: / keyframe at 0\.00s$/ }),
  ).toHaveCount(1);

  await setReactionPlayhead(page, 0.3);
  await setExpression(page, "happy", 0);
  await expectKeyframes(page, 2);
  await setExpression(page, "angry", 1);
  await expectKeyframes(page, 2);
  await expect(
    page.getByRole("button", { name: / keyframe at 0\.30s$/ }),
  ).toHaveCount(1);
  await expect(
    page.locator('input[aria-label="Clip timeline playhead time"]:visible'),
  ).toHaveValue("0.3");
}

/**
 * Validate the exact portable clip shown by View JSON and saved to disk: the
 * 2.0 form of the authored timeline, one beat per expression keyframe.
 */
export function validateReactionClipDocument(
  value: unknown,
  expectedName: string,
): ValidatedReactionClip {
  const clip = record(value, "Reaction Clip JSON");
  if (clip.schema !== "animaPoseClip/2.0") {
    throw new Error("Reaction Clip JSON must use animaPoseClip/2.0.");
  }
  if (clip.id !== expectedName || clip.name !== expectedName) {
    throw new Error("Reaction Clip JSON ID and name must match the run name.");
  }
  exactNumber(clip.duration, 1.2, "Reaction Clip duration");
  if ((clip.loop ?? false) !== false) {
    throw new Error("Reaction Clip JSON must be effectively non-looping.");
  }
  for (const field of ["joints", "rotations", "hipsPosition", "hands"])
    if (field in clip)
      throw new Error(`A Reaction Clip must not carry ${field} tracks.`);

  const beats = array(clip.beats, "Reaction Clip beats").map((beat, index) =>
    record(beat, `Reaction Clip beats[${index}]`),
  );
  if (beats.length !== 2) {
    throw new Error("Reaction Clip must contain exactly two beats.");
  }
  exactNumber(beats[0].time, 0, "Reaction Clip beats[0].time");
  exactNumber(beats[1].time, 0.3, "Reaction Clip beats[1].time");
  const ids = beats.map((beat) => beat.id);
  if (typeof ids[0] !== "string" || ids[0] === ids[1]) {
    throw new Error("Reaction Clip beats must have two distinct ids.");
  }

  // Each expression is keyed at both beats: happy, then angry.
  const expressions = record(clip.expressions, "Reaction Clip expressions");
  const valuesAtBeats = (name: string) =>
    array(expressions[name], `Reaction Clip expressions.${name}`).map(
      (key, index) => {
        const entry = record(
          key,
          `Reaction Clip expressions.${name}[${index}]`,
        );
        if (entry.beat !== ids[index] || entry.dt !== undefined)
          throw new Error(`Reaction ${name} keys must sit on the two beats.`);
        return entry.v;
      },
    );
  if (Object.keys(expressions).sort().join() !== "angry,happy") {
    throw new Error("Reaction Clip must key exactly happy and angry.");
  }
  exactRecord(
    { happy: valuesAtBeats("happy"), angry: valuesAtBeats("angry") },
    { happy: [1, 0], angry: [0, 1] },
    "Reaction Clip expression values",
  );

  const normalizedEvents =
    clip.events === undefined ? [] : array(clip.events, "Reaction Clip events");
  if (normalizedEvents.length !== 0) {
    throw new Error("Reaction Clip must not contain events.");
  }
  return clip as ValidatedReactionClip;
}

/** Validate the readable descriptor paired with the saved sequence file. */
export function validateReactionMetadata(
  value: unknown,
  expected: { logicalKey: string; name: string },
): JsonRecord {
  const metadata = record(value, "Reaction metadata");
  if (
    metadata.schema_version !== 1 ||
    metadata.content_type !== "reaction" ||
    metadata.id !== expected.logicalKey ||
    metadata.name !== expected.name
  ) {
    throw new Error("Reaction metadata identity does not match the journey.");
  }
  exactRecord(
    record(metadata.placement_hint, "Reaction metadata placement_hint"),
    { emotion: "joy", intensity: 1 },
    "Reaction metadata placement_hint",
  );
  exactRecord(
    record(metadata.implementation, "Reaction metadata implementation"),
    { kind: "anima_clip", file_role: "sequence" },
    "Reaction metadata implementation",
  );
  const files = array(metadata.files, "Reaction metadata files");
  if (files.length !== 1) {
    throw new Error(
      "Reaction metadata must register exactly one sequence file.",
    );
  }
  exactRecord(
    record(files[0], "Reaction metadata files[0]"),
    { path: `${expected.name}.json`, role: "sequence" },
    "Reaction metadata files[0]",
  );
  const dependencies = array(
    metadata.dependencies,
    "Reaction metadata dependencies",
  );
  if (dependencies.length !== 0) {
    throw new Error("Reaction metadata dependencies must be empty.");
  }
  return metadata;
}
