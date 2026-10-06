import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  MAX_ANIMA_POSE_CLIP_BYTES,
  parseAnimaPoseClip,
  serializeAnimaPoseClipFile,
} from "../poses/animaPoseClip";
import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../poses/catalog";
import {
  JOINT_DEFINITIONS,
  JOINT_IDS,
  decomposeJointRotation,
  resolveJoint,
} from "./anatomy";
import {
  BAKE_TOLERANCE_DEGREES,
  BAKE_TOLERANCE_METRES,
  bakeMotion,
} from "./bake";
import { checkMotion, formatMotionCheckReport } from "./checks";
import {
  MOTION_DESCRIPTION_SCHEMA,
  formatMotionDescriptionIssues,
  parseMotionDescription,
  type MotionDescription,
} from "./description";
import {
  INCLUDED_AVATAR_FILES,
  REFERENCE_AVATAR_ID,
  loadHeadlessVrm,
  type IncludedAvatarId,
} from "./headlessVrm";
import { Quaternion } from "three";
import {
  loadReviewSidecar,
  resolveReviewNote,
  retainReviewVersion,
  reviewPathsFor,
  saveReviewSidecar,
  type ReviewSidecar,
} from "./preview/reviewNotes";
import { sourceVersion } from "./preview/sources";

export type MotionCliContext = {
  /** Directory holding the Included `.vrm` files. */
  avatarDirectory: string;
  /** Working directory for relative paths. */
  cwd: string;
  out: (text: string) => void;
};

const USAGE = `Usage: pnpm animation <command>

Commands:
  joints                      List joints, components, meanings and ranges.
  base                        Print the base pose (Relaxed Rest) as joint values.
  generate <motion.json> [--out <clip.json>]
                              Validate a motion description and bake a Gesture clip.
  check <motion.json | clip.json> [--description <motion.json>] [--json]
                              Run the motion checks on both Included Avatars.
                              A description supplies contacts and plantFeet.
  review <notes.review.json>  List preview review notes with their ids and status.
  resolve <notes.review.json> <note id> <resolution>
                              Mark a note resolved by the reviewed source's
                              current version (run after changing the source).`;

/** Run a motion-authoring command. Returns the process exit code. */
export async function runMotionCli(
  argv: readonly string[],
  context: MotionCliContext,
): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "joints":
      context.out(formatJointTable());
      return 0;
    case "base":
      context.out(JSON.stringify(baseJointValues(), null, 2));
      return 0;
    case "generate":
      return generate(rest, context);
    case "check":
      return check(rest, context);
    case "review":
      return review(rest, context);
    case "resolve":
      return resolve(rest, context);
    default:
      context.out(USAGE);
      return command === undefined || command === "help" ? 0 : 2;
  }
}

async function generate(
  args: readonly string[],
  context: MotionCliContext,
): Promise<number> {
  const input = args[0];
  if (!input) {
    context.out(USAGE);
    return 2;
  }
  const options = parseOptions(args.slice(1), ["--out"]);
  if ("error" in options) {
    context.out(`${options.error}\n\n${USAGE}`);
    return 2;
  }
  const inputPath = path.resolve(context.cwd, input);
  const outputPath = options.values["--out"]
    ? path.resolve(context.cwd, options.values["--out"])
    : inputPath.replace(/(\.motion)?\.json$/, "") + ".clip.json";

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(inputPath, "utf8"));
  } catch (error) {
    context.out(`Cannot read ${input}: ${(error as Error).message}`);
    return 1;
  }
  const parsed = parseMotionDescription(raw);
  if (!parsed.ok) {
    context.out(
      `Invalid motion description (${parsed.issues.length} issue(s)):\n` +
        formatMotionDescriptionIssues(parsed.issues),
    );
    return 1;
  }
  const reference = await loadAvatar(REFERENCE_AVATAR_ID, context);
  const { clip, report } = bakeMotion(parsed.description, reference);
  if (!report.withinTolerance) {
    context.out(
      `Not written: baked playback strays ${report.maxBakeErrorDegrees}° / ${report.maxBakePositionError} m from the curves ` +
        `(limits ${BAKE_TOLERANCE_DEGREES}° / ${BAKE_TOLERANCE_METRES} m). Spread keys that change faster than the sample spacing allows.`,
    );
    return 1;
  }
  // Measure the file the creator will save, after its own sanitization.
  let savedBytes: number;
  try {
    savedBytes = Buffer.byteLength(
      serializeAnimaPoseClipFile(parseAnimaPoseClip(clip)),
    );
  } catch (error) {
    context.out(
      `Not written: the baked clip is not a valid animaPoseClip (${(error as Error).message}).`,
    );
    return 1;
  }
  if (savedBytes > MAX_ANIMA_POSE_CLIP_BYTES) {
    context.out(
      `Not written: the clip saves as ${formatKilobytes(savedBytes)}, over the ${formatKilobytes(MAX_ANIMA_POSE_CLIP_BYTES)} the app will load. ` +
        `Shorten the clip, or remove keys that add little visible motion.`,
    );
    return 1;
  }
  await writeFile(outputPath, `${JSON.stringify(clip, null, 2)}\n`);
  context.out(
    [
      `Wrote ${displayPath(outputPath, context.cwd)}`,
      `  id ${clip.id}, ${clip.duration}s, ${clip.loop ? "loop" : "one-shot"}, ${report.keyframes} keyframes`,
      `  animated bones: ${report.animatedBones.length}; expressions: ${report.expressions.join(", ") || "none"}`,
      `  max bake error: ${report.maxBakeErrorDegrees}°, ${report.maxBakePositionError} m`,
      `  saved size: ${formatKilobytes(savedBytes)} of ${formatKilobytes(MAX_ANIMA_POSE_CLIP_BYTES)}`,
      `  muted layers: ${clip.mutedProceduralLayers.join(", ") || "none"}`,
    ].join("\n"),
  );
  return 0;
}

async function review(
  args: readonly string[],
  context: MotionCliContext,
): Promise<number> {
  if (args.length !== 1) {
    context.out(USAGE);
    return 2;
  }
  const loaded = await loadExistingSidecar(args[0], context);
  if (!loaded) return 1;
  context.out(formatReviewNotes(loaded.sidecar));
  return 0;
}

async function resolve(
  args: readonly string[],
  context: MotionCliContext,
): Promise<number> {
  const [file, id, ...words] = args;
  const resolution = words.join(" ").trim();
  if (!file || !id || !resolution) {
    context.out(USAGE);
    return 2;
  }
  const loaded = await loadExistingSidecar(file, context);
  if (!loaded) return 1;
  const { sidecar, sidecarPath } = loaded;
  const sourcePath = path.resolve(path.dirname(sidecarPath), sidecar.source);
  let text: string;
  try {
    text = await readFile(sourcePath, "utf8");
  } catch (error) {
    context.out(`Cannot read the reviewed source: ${(error as Error).message}`);
    return 1;
  }
  const version = sourceVersion(text);
  const note = sidecar.notes.find((candidate) => candidate.id === id);
  if (!note) {
    context.out(`No review note "${id}". Run review to list them.`);
    return 1;
  }
  if (note.version === version)
    context.out(
      `Note: ${displayPath(sourcePath, context.cwd)} has not changed since this note was made.`,
    );
  const paths = reviewPathsFor(
    { kind: "file", path: sourcePath, name: "" },
    { cwd: context.cwd, notes: sidecarPath },
  );
  // Retain the resolving version so the preview can compare it.
  const next = resolveReviewNote(
    await retainReviewVersion(sidecar, paths, version, text),
    id,
    resolution,
    { version },
  );
  await saveReviewSidecar(sidecarPath, next);
  context.out(`Resolved ${id} with source version ${version}.`);
  return 0;
}

async function loadExistingSidecar(
  file: string,
  context: MotionCliContext,
): Promise<{ sidecar: ReviewSidecar; sidecarPath: string } | null> {
  const sidecarPath = path.resolve(context.cwd, file);
  try {
    await readFile(sidecarPath);
    return {
      sidecar: await loadReviewSidecar(sidecarPath, ""),
      sidecarPath,
    };
  } catch (error) {
    context.out(
      (error as NodeJS.ErrnoException).code === "ENOENT"
        ? `No review notes at ${file}.`
        : (error as Error).message,
    );
    return null;
  }
}

function formatReviewNotes(sidecar: ReviewSidecar): string {
  const open = sidecar.notes.filter(({ status }) => status === "open").length;
  return [
    `${sidecar.source}: ${open} open, ${sidecar.notes.length - open} resolved`,
    ...[...sidecar.notes]
      .sort((a, b) => a.time - b.time)
      .flatMap((note) => [
        `  ${note.id}  ${note.status.padEnd(8)} ${note.time.toFixed(2)}s${note.beat ? ` · ${note.beat}` : ""}${note.region ? ` · ${note.region}` : ""}  ${note.text}`,
        ...(note.resolution ? [`      → ${note.resolution}`] : []),
      ]),
  ].join("\n");
}

/** Accept only the named `--flag value` options; anything else is an error. */
function parseOptions(
  args: readonly string[],
  names: readonly string[],
): { values: Record<string, string> } | { error: string } {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!names.includes(name)) return { error: `Unknown option ${name}.` };
    if (value === undefined || value.startsWith("--"))
      return { error: `${name} needs a value.` };
    values[name] = value;
  }
  return { values };
}

function displayPath(file: string, cwd: string): string {
  const relative = path.relative(cwd, file);
  return relative.startsWith("..") ? file : relative;
}

async function readJson(
  file: string,
  context: MotionCliContext,
): Promise<{ value: unknown } | { error: string }> {
  try {
    return {
      value: JSON.parse(
        await readFile(path.resolve(context.cwd, file), "utf8"),
      ),
    };
  } catch (error) {
    return { error: `Cannot read ${file}: ${(error as Error).message}` };
  }
}

function describe(
  value: unknown,
  context: MotionCliContext,
): MotionDescription | null {
  const parsed = parseMotionDescription(value);
  if (parsed.ok) return parsed.description;
  context.out(
    `Invalid motion description (${parsed.issues.length} issue(s)):\n` +
      formatMotionDescriptionIssues(parsed.issues),
  );
  return null;
}

async function check(
  args: readonly string[],
  context: MotionCliContext,
): Promise<number> {
  const input = args[0];
  const json = args.includes("--json");
  const options = parseOptions(
    args.slice(1).filter((arg) => arg !== "--json"),
    ["--description"],
  );
  if (!input || "error" in options) {
    context.out(`${"error" in options ? `${options.error}\n\n` : ""}${USAGE}`);
    return 2;
  }
  const read = await readJson(input, context);
  if ("error" in read) {
    context.out(read.error);
    return 1;
  }
  const avatars = await Promise.all(
    (Object.keys(INCLUDED_AVATAR_FILES) as IncludedAvatarId[]).map(
      async (id) => ({ id, vrm: await loadAvatar(id, context) }),
    ),
  );
  let clip = read.value;
  let description: MotionDescription | null = null;
  const isDescription =
    typeof read.value === "object" &&
    read.value !== null &&
    (read.value as { schema?: unknown }).schema === MOTION_DESCRIPTION_SCHEMA;
  if (isDescription) {
    description = describe(read.value, context);
    if (!description) return 1;
    if (options.values["--description"])
      context.out(
        "Ignoring --description: the input is already a description.",
      );
    const reference = avatars.find(({ id }) => id === REFERENCE_AVATAR_ID)!;
    clip = bakeMotion(description, reference.vrm).clip;
  } else if (options.values["--description"]) {
    const extra = await readJson(options.values["--description"], context);
    if ("error" in extra) {
      context.out(extra.error);
      return 1;
    }
    description = describe(extra.value, context);
    if (!description) return 1;
  }
  let report;
  try {
    report = checkMotion(clip, avatars, {
      contacts: description?.contacts,
      plantFeet: description?.plantFeet !== false,
    });
  } catch (error) {
    context.out(`Cannot check ${input}: ${(error as Error).message}`);
    return 1;
  }
  context.out(
    json ? JSON.stringify(report, null, 2) : formatMotionCheckReport(report),
  );
  return report.ok ? 0 : 1;
}

export async function loadAvatar(
  id: IncludedAvatarId,
  context: Pick<MotionCliContext, "avatarDirectory">,
) {
  const file = await readFile(
    path.join(context.avatarDirectory, INCLUDED_AVATAR_FILES[id]),
  );
  return loadHeadlessVrm(
    file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer,
  );
}

function baseJointValues(): Record<string, Record<string, number>> {
  const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};
  return Object.fromEntries(
    JOINT_IDS.map((id) => {
      const joint = resolveJoint(id)!;
      const rotation = base[joint.bones[0]]?.rotation;
      const values = decomposeJointRotation(
        joint,
        rotation ? new Quaternion(...rotation) : new Quaternion(),
      );
      return [
        id,
        Object.fromEntries(
          Object.entries(values).map(([name, value]) => [
            name,
            Math.round(value * 10) / 10,
          ]),
        ),
      ];
    }),
  );
}

function formatJointTable(): string {
  const lines: string[] = [];
  for (const [type, definition] of Object.entries(JOINT_DEFINITIONS)) {
    const ids = JOINT_IDS.filter((id) => resolveJoint(id)!.type === type);
    lines.push(`${ids.join(", ")}`);
    for (const [name, component] of Object.entries(definition.components))
      lines.push(
        `  ${name}: ${component.description} Natural ${component.soft[0]}..${component.soft[1]}, limit ${component.hard[0]}..${component.hard[1]}.`,
      );
  }
  return lines.join("\n");
}

function formatKilobytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}
