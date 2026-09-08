import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postcss from "postcss";
import tailwindcss from "@tailwindcss/postcss";
// Compile only this package's components. Consumers need no source aliases or Tailwind toolchain.
const source = fileURLToPath(new URL("./src/styles.css", import.meta.url));
const target = fileURLToPath(new URL("./dist/styles.css", import.meta.url));
const result = await postcss([tailwindcss()]).process(
  await readFile(source, "utf8"),
  { from: source, to: target, map: false },
);
await writeFile(target, result.css);
