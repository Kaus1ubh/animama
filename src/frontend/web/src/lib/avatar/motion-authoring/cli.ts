import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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
                              A description supplies contacts and plantFeet.`;

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
  await writeFile(outputPath, `${JSON.stringify(clip, null, 2)}\n`);
  context.out(
    [
      `Wrote ${displayPath(outputPath, context.cwd)}`,
      `  id ${clip.id}, ${clip.duration}s, ${clip.loop ? "loop" : "one-shot"}, ${report.keyframes} keyframes`,
      `  animated bones: ${report.animatedBones.length}; expressions: ${report.expressions.join(", ") || "none"}`,
      `  max bake error: ${report.maxBakeErrorDegrees}°, ${report.maxBakePositionError} m`,
      `  muted layers: ${clip.mutedProceduralLayers.join(", ") || "none"}`,
    ].join("\n"),
  );
  return 0;
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
