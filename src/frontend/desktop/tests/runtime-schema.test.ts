import { afterEach, describe, expect, it, vi } from "vitest";
import {
  databaseSchemaDigest,
  normalizeSchemaDump,
} from "../src/main-process/runtime/schema.js";
import { runCommand } from "../src/main-process/runtime/processes.js";

vi.mock("../src/main-process/runtime/processes.js", () => ({
  runCommand: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

/** A representative pg_dump layout: version header, per-run restrict key, then DDL. */
function dump(version: string, key: string, constraint: string): string {
  return [
    "--",
    "-- PostgreSQL database dump",
    "--",
    "",
    `\\restrict ${key}`,
    "",
    `-- Dumped from database version ${version}`,
    `-- Dumped by pg_dump version ${version}`,
    "",
    "SET statement_timeout = 0;",
    "",
    "--",
    "-- Name: content_catalog_items; Type: TABLE; Schema: public; Owner: -",
    "--",
    "",
    "CREATE TABLE public.content_catalog_items (",
    "    kind text NOT NULL,",
    `    CONSTRAINT ck_content_catalog_items_kind_values CHECK ((kind = ANY (ARRAY[${constraint}])))`,
    ");",
    "",
    `\\unrestrict ${key}`,
    "",
  ].join("\n");
}

describe("database schema digest", () => {
  it("ignores version headers, comments and per-run restrict keys", () => {
    expect(normalizeSchemaDump(dump("16.15", "aaa", "'avatar'"))).toBe(
      normalizeSchemaDump(dump("16.16", "bbb", "'avatar'")),
    );
    expect(normalizeSchemaDump(dump("16.15", "aaa", "'avatar'"))).toBe(
      [
        "SET statement_timeout = 0;",
        "CREATE TABLE public.content_catalog_items (",
        "    kind text NOT NULL,",
        "    CONSTRAINT ck_content_catalog_items_kind_values CHECK ((kind = ANY (ARRAY['avatar'])))",
        ");",
        "",
      ].join("\n"),
    );
  });

  it("dumps only schema definitions and distinguishes a changed constraint", async () => {
    vi.mocked(runCommand)
      .mockResolvedValueOnce(dump("16.15", "aaa", "'avatar'"))
      .mockResolvedValueOnce(dump("16.15", "bbb", "'avatar'"))
      .mockResolvedValueOnce(dump("16.15", "ccc", "'avatar', 'pose'"));
    const env = { PGDATABASE: "animama" };
    const first = await databaseSchemaDigest("pg_dump", env, "/profile");
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(await databaseSchemaDigest("pg_dump", env, "/profile")).toBe(first);
    expect(await databaseSchemaDigest("pg_dump", env, "/profile")).not.toBe(
      first,
    );
    expect(runCommand).toHaveBeenCalledWith(
      "pg_dump",
      ["--schema-only", "--no-owner", "--no-privileges", "--no-comments"],
      env,
      "/profile",
    );
  });
});
