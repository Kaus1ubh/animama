import { lstat, readFile } from "node:fs/promises";

const INTERNAL_TOKEN_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export type InternalTokenSource =
  | { kind: "value"; value: string }
  | { kind: "file"; path: string };

function requireToken(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!INTERNAL_TOKEN_HEX_PATTERN.test(normalized)) {
    throw new Error("internal gateway token must encode exactly 32 bytes");
  }
  return normalized;
}

/** Load a 32-byte gateway credential without ever returning its source path. */
export async function loadInternalToken(
  source: InternalTokenSource,
): Promise<string> {
  if (source.kind === "value") {
    return requireToken(source.value);
  }

  try {
    const metadata = await lstat(source.path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new Error("internal gateway token source must be a regular file");
    }
    if ((metadata.mode & 0o777) !== 0o600) {
      throw new Error("internal gateway token file must have mode 0600");
    }
    return requireToken(await readFile(source.path, "utf8"));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("internal gateway token")
    ) {
      throw error;
    }
    throw new Error("internal gateway token file is unavailable");
  }
}
