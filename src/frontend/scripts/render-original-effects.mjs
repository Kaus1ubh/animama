import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// Original vector sources are the editable masters. Render both registered
// effects and their authoring copies together so they never drift apart.
const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsRoot, "../../..");
const effectsRoot = path.join(repositoryRoot, "content/included/vfx/avatar");
const names = [
  "emote",
  "texture_black_1",
  "texture_sick_1",
  "texture_sick_2",
  "texture_sick_3",
];

for (const name of names) {
  const source = await readFile(
    path.join(scriptsRoot, "assets/original-effects", `${name}.svg`),
  );
  const png = await sharp(source).ensureAlpha().png().toBuffer();
  await writeFile(path.join(effectsRoot, name, `${name}.png`), png);
  if (name !== "emote") {
    await writeFile(path.join(effectsRoot, "face/full", `${name}.png`), png);
  }
  console.log(`Rendered ${name}`);
}
