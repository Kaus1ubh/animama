import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAvatarFile } from "./avatar-file.mjs";
import { withRendererPage } from "./effect-render.mjs";

/**
 * Render a converted Avatar's authored lilToon materials for comparison with
 * Unity's lilToon.
 *
 *   pnpm -s avatar:parity-render --avatar-file <a.vrm> --out <dir> [--size 640x800]
 *
 * Draws the rest pose (body, face, face from its right) with one white key
 * light and white ambient light, no tone mapping and sRGB output, on
 * SwiftShader, and writes `animama-<view>.png` and `views.json` into `--out`.
 * `scripts/avatars/unity/AnimamaReferenceRender.cs` renders the same views in
 * Unity from `views.json`. The Avatar and its renders are third-party files:
 * keep `--out` outside the repository.
 */

const USAGE =
  "Usage: pnpm -s avatar:parity-render --avatar-file <a.vrm> --out <dir> [--size 640x800]";

/** Parse the command line; returns `{ options }`, `{ help: true }` or `{ error }`. */
export function parseParityArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help") return { help: true };
    if (!["--avatar-file", "--out", "--size"].includes(arg))
      return { error: `Unknown option ${arg}.` };
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--"))
      return { error: `${arg} needs a value.` };
    values[arg] = value;
    index++;
  }
  if (!values["--avatar-file"]) return { error: "--avatar-file is required." };
  if (!values["--out"]) return { error: "--out is required." };
  const size = /^(\d+)x(\d+)$/.exec(values["--size"] ?? "640x800");
  const [width, height] = size ? [Number(size[1]), Number(size[2])] : [0, 0];
  if (!size || width < 64 || height < 64 || width > 2048 || height > 2048)
    return { error: "--size takes WIDTHxHEIGHT, each from 64 to 2048." };
  return {
    options: {
      avatarFile: values["--avatar-file"],
      out: values["--out"],
      width,
      height,
    },
  };
}

async function main(argv) {
  const parsed = parseParityArgs(argv);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  if (parsed.error) {
    console.error(`${parsed.error}\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  const { avatarFile, out, width, height } = parsed.options;
  // pnpm runs scripts from the package; resolve paths from where it was called.
  const cwd = process.env.INIT_CWD ?? process.cwd();
  let file;
  try {
    file = await resolveAvatarFile(path.resolve(cwd, avatarFile));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
    return;
  }
  const outDir = path.resolve(cwd, out);
  await mkdir(outDir, { recursive: true });
  let result;
  try {
    result = await withRendererPage(
      { pageDir: "liltoon-parity", extraRoots: [file] },
      ({ page, fsUrl }) =>
        page.evaluate((request) => window.renderLilToonParity(request), {
          url: fsUrl(file),
          width,
          height,
        }),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }
  const { images, views } = result;
  for (const image of images) {
    const target = path.join(outDir, `animama-${image.name}.png`);
    await writeFile(target, Buffer.from(image.dataUrl.split(",")[1], "base64"));
    console.log(`Wrote ${target}`);
  }
  await writeFile(
    path.join(outDir, "views.json"),
    `${JSON.stringify({ views }, null, 2)}\n`,
  );
  console.log(`Wrote ${path.join(outDir, "views.json")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2));
