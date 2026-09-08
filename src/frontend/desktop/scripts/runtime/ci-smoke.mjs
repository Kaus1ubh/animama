import path from "node:path";
import { desktopRoot, readJson } from "./common.mjs";
import { verifyArtifactIndex } from "./release-artifacts.mjs";
import { smokeMac } from "./smoke-macos.mjs";

const setup = process.env.ANIMAMA_SMOKE_SETUP;
if (setup !== "name") throw new Error("Expected the fixed CI setup variant");
const directory = path.join(desktopRoot, "release/publish");
const index = verifyArtifactIndex(directory);
if (
  index.app_version !== readJson(path.join(desktopRoot, "package.json")).version
)
  throw new Error("CI artifact version does not match checkout");
await smokeMac([
  "--artifact",
  path.join(directory, `Animama-${index.app_version}-arm64.dmg`),
  "--setup",
  setup,
]);
