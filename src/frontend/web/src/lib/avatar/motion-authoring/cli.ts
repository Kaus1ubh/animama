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
import {
  formatMotionDescriptionIssues,
  parseMotionDescription,
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
                              Validate a motion description and bake a Gesture clip.`;

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
