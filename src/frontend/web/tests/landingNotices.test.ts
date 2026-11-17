import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ADAPTED_CODE, adaptedCodeNotices } from "../scripts/landing-build.mjs";

const webRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(webRoot, "../../..");
const shimmer = path.join(webRoot, "scripts/landing-stage/text-shimmer.tsx");

describe("landing page notices", () => {
  it("ships Motion Primitives' MIT text when the bundle holds the text shimmer", () => {
    const text = adaptedCodeNotices([`${shimmer}?used`, "/elsewhere/a.js"]);
    expect(text).toContain("Motion Primitives (text-shimmer.tsx) — MIT");
    expect(text).toContain("Copyright (c) 2024 ibelick");
    expect(text).toContain("Permission is hereby granted");
  });

  it("omits adapted code the bundle does not hold", () => {
    const text = adaptedCodeNotices(["/elsewhere/a.js"]);
    expect(text).not.toContain("ibelick");
  });

  it("names each adapted source the licence record lists", () => {
    const record = readFileSync(
      path.join(repoRoot, "licenses/third-party/adapted-code.md"),
      "utf8",
    );
    for (const { file, notice } of ADAPTED_CODE) {
      expect(existsSync(path.join(webRoot, file))).toBe(true);
      expect(existsSync(path.join(repoRoot, notice))).toBe(true);
      expect(record).toContain(`src/frontend/web/${file}`);
    }
  });
});
