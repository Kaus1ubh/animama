import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  conversionExitCode,
  EXPORTER_RELEASE,
  exporterArgs,
  exporterCommand,
  exporterSource,
  outputPaths,
  parseArgs,
} from "./vrm-convert-vrchat.mjs";

const REQUIRED = [
  "--project",
  "/unity/Avatar",
  "--prefab",
  "Assets/Avatar/Avatar.prefab",
  "--out",
  "/private/Avatar.vrm",
];

test("the CLI requires a project, a prefab and a .vrm output, and refuses unknown options", () => {
  const { options, flags } = parseArgs([...REQUIRED, "--keep-pose"]);
  assert.equal(options.project, "/unity/Avatar");
  assert.equal(options.prefab, "Assets/Avatar/Avatar.prefab");
  assert.equal(flags.keepPose, true);
  assert.equal(flags.optimize, true);
  assert.equal(parseArgs([...REQUIRED, "--no-optimize"]).flags.optimize, false);

  assert.throws(() => parseArgs(REQUIRED.slice(2)), /--project is required/);
  assert.throws(
    () => parseArgs([...REQUIRED.slice(0, 4), "--out", "/private/Avatar.glb"]),
    /--out must end in \.vrm/,
  );
  assert.throws(
    () => parseArgs([...REQUIRED, "--nographics"]),
    /Unknown option --nographics/,
  );
  assert.throws(
    () => parseArgs([...REQUIRED, "--name"]),
    /--name needs a value/,
  );
  assert.equal(parseArgs(["--help"]).flags.help, true);
});

test("an optimized conversion keeps the raw export beside it; --no-optimize writes one file", () => {
  assert.deepEqual(outputPaths("/private/Avatar.vrm", true), {
    final: "/private/Avatar.vrm",
    raw: "/private/Avatar.raw.vrm",
    log: "/private/Avatar.export.log",
  });
  assert.deepEqual(outputPaths("/private/Avatar.vrm", false), {
    final: "/private/Avatar.vrm",
    raw: "/private/Avatar.vrm",
    log: "/private/Avatar.export.log",
  });
});

test("the pinned exporter release installs its own Unity package; a checkout installs its own", () => {
  assert.match(
    EXPORTER_RELEASE,
    /^github:raymond-van\/animama-avatar-export#v\d+\.\d+\.\d+$/,
  );
  assert.deepEqual(exporterSource(undefined), {
    spec: EXPORTER_RELEASE,
    packageSpec: null,
  });
  const checkout = path.resolve("/src/animama-avatar-export");
  assert.deepEqual(exporterSource("/src/animama-avatar-export"), {
    spec: checkout,
    packageSpec: `file:${path.join(checkout, "Packages", "com.animama.avatar-export")}`,
  });
});

test("the exporter writes the raw export with the options given", () => {
  const args = exporterArgs({
    options: {
      project: "/unity/Avatar",
      prefab: "Assets/Avatar/Avatar.prefab",
      out: "/private/Avatar.vrm",
      name: "Avatar",
      author: "Author",
      unity: "/editors/Unity",
    },
    flags: { keepPose: true, optimize: true, validate: false },
    raw: "/private/Avatar.raw.vrm",
    log: "/private/Avatar.export.log",
    packageSpec: null,
  });
  assert.deepEqual(args, [
    "--project",
    "/unity/Avatar",
    "--prefab",
    "Assets/Avatar/Avatar.prefab",
    "--out",
    "/private/Avatar.raw.vrm",
    "--log",
    "/private/Avatar.export.log",
    "--name",
    "Avatar",
    "--author",
    "Author",
    "--unity",
    "/editors/Unity",
    "--keep-pose",
  ]);

  const validate = exporterArgs({
    options: { project: "/p", prefab: "A", out: "/o/A.vrm" },
    flags: { keepPose: false, optimize: false, validate: true },
    raw: "/o/A.vrm",
    log: "/o/A.export.log",
    packageSpec: "file:/src/pkg",
  });
  assert.deepEqual(validate.slice(-3), [
    "--validate",
    "--package",
    "file:/src/pkg",
  ]);
});

test("pnpm dlx runs the exporter through Node, with pnpm's default reporter", () => {
  const args = ["--project", "/p"];
  assert.deepEqual(
    exporterCommand(
      "/corepack/pnpm.cjs",
      "/usr/bin/node",
      EXPORTER_RELEASE,
      args,
    ),
    {
      command: "/usr/bin/node",
      args: [
        "/corepack/pnpm.cjs",
        "--reporter=default",
        "dlx",
        `--package=${EXPORTER_RELEASE}`,
        "animama-avatar-export",
        "--project",
        "/p",
      ],
    },
  );
  assert.equal(
    exporterCommand("C:\\pnpm\\pnpm.exe", "node", "/src/exporter", args)
      .command,
    "C:\\pnpm\\pnpm.exe",
  );
  assert.throws(
    () => exporterCommand(undefined, "node", EXPORTER_RELEASE, args),
    /through pnpm/,
  );
});

test("the exporter's exit code passes through as 0, 2 or 1", () => {
  assert.equal(conversionExitCode(0), 0);
  assert.equal(conversionExitCode(2), 2);
  assert.equal(conversionExitCode(1), 1);
  assert.equal(conversionExitCode(254), 1);
});
