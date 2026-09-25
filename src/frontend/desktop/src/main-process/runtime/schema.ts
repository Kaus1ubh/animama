import { createHash } from "node:crypto";
import { runCommand } from "./processes.js";

/**
 * Ownership, grants and object comments do not affect compatibility, and the
 * owning role differs between the staging database and real profiles.
 */
const SCHEMA_DUMP_ARGS = [
  "--schema-only",
  "--no-owner",
  "--no-privileges",
  "--no-comments",
];

/**
 * Keep only DDL. pg_dump adds version headers and, since PostgreSQL 16.10, a
 * random `\restrict` key on each run. Neither describes the schema.
 */
export function normalizeSchemaDump(dump: string): string {
  const lines = dump
    .split("\n")
    .filter(
      (line) =>
        line.trim() !== "" &&
        !line.startsWith("--") &&
        !/^\\(?:un)?restrict\s/u.test(line),
    );
  return lines.join("\n") + "\n";
}

/**
 * Hash the live schema of the database that `env` selects. Runtime staging
 * records this digest for a freshly bootstrapped database. Startup compares a
 * profile against it, because an edited development baseline keeps the same
 * Alembic head.
 */
export async function databaseSchemaDigest(
  pgDump: string,
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<string> {
  const dump = await runCommand(pgDump, SCHEMA_DUMP_ARGS, env, cwd);
  return createHash("sha256").update(normalizeSchemaDump(dump)).digest("hex");
}
