import { isBuiltin } from "node:module";

/** Every other JS dependency must be in the bundle, not a developer's modules. */
export function assertBundledImports(metafile) {
  for (const [name, output] of Object.entries(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (!dependency.external) continue;
      if (isBuiltin(dependency.path) || dependency.path === "electron")
        continue;
      throw new Error(
        `Undeclared runtime import in ${name}: ${dependency.path}`,
      );
    }
  }
  for (const name of Object.keys(metafile.inputs)) {
    if (
      /(?:^|\/)(?:hono|@hono|animama-frontend-server)(?:[@/]|$)|(?:^|\/)server\/src\//.test(
        name,
      )
    )
      throw new Error(
        "Hono and the retired frontend server cannot enter the desktop bundle",
      );
    if (/(?:better-auth|@better-auth)(?:\/|$)/.test(name))
      throw new Error("Better Auth cannot enter the local desktop bundle");
  }
}
