import { realpath, stat } from "node:fs/promises";

/**
 * Resolve a review tool's `--avatar-file` to the real path of one `.vrm` file.
 * The tools' Vite servers allow exactly that path, so it must be a regular
 * file (a directory would open its whole tree) and must avoid characters
 * Vite's `/@fs` route cannot serve, even percent-encoded.
 *
 * @throws Error with a message naming the problem.
 */
export async function resolveAvatarFile(file) {
  let resolved;
  try {
    resolved = await realpath(file);
  } catch {
    throw new Error(`--avatar-file not found: ${file}`);
  }
  if (
    !resolved.toLowerCase().endsWith(".vrm") ||
    !(await stat(resolved)).isFile()
  )
    throw new Error(`--avatar-file must be a .vrm file: ${file}`);
  if (/[#?%]/.test(resolved))
    throw new Error(
      `--avatar-file path must not contain #, ? or %; rename or move it: ${resolved}`,
    );
  return resolved;
}
