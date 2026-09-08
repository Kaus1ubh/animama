import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== "--destination")) {
  throw new Error("Usage: pnpm packages:pack [--destination DIRECTORY]");
}
const destination = resolve(frontendRoot, args[1] ?? ".artifacts/public-packages");
await mkdir(destination, { recursive: true });
/** Build first, then pack exact local artifacts without publishing anything. */
async function run(args, cwd) {
  await new Promise((complete, fail) => {
    const child = spawn("pnpm", args, { cwd, stdio: "inherit" });
    child.once("error", fail);
    child.once("exit", (code) => code === 0 ? complete() : fail(new Error(`pnpm exited ${code}`)));
  });
}
await run(["packages:build"], frontendRoot);
for (const name of ["runtime-contracts", "discover-client", "product-ui"]) {
  await run(["pack", "--pack-destination", destination], resolve(frontendRoot, "packages", name));
}
