import {
  closeSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { RuntimeError } from "./errors.js";

/** Walk without following links before creating any private state directory. */
export function privateDirectory(directory: string): void {
  const absolute = path.resolve(directory);
  let cursor = path.parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const stat = lstatSync(cursor);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new RuntimeError("private_state_path_invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
}

/** Save private state with same-directory promotion and durable directory metadata. */
export function atomicWrite(file: string, data: string | Buffer): void {
  const parent = path.dirname(file);
  privateDirectory(parent);
  const temporary = path.join(
    parent,
    `.${path.basename(file)}.${randomUUID()}.tmp`,
  );
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    try {
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
        throw new RuntimeError("private_state_path_invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    renameSync(temporary, file);
    const folder = openSync(parent, "r");
    try {
      fsyncSync(folder);
    } finally {
      closeSync(folder);
    }
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}
