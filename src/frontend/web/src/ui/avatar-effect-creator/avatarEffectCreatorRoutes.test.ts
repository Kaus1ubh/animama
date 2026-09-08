import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Avatar Effect creator routes", () => {
  it.each([
    ["routes/a/avatar-effects.new.tsx", "/a/avatar-effects/new"],
    [
      "routes/a/avatar-effects.$avatarEffectId.edit.tsx",
      "/a/avatar-effects/$avatarEffectId/edit",
    ],
  ])("registers %s as a full-canvas creator route", async (relative, route) => {
    const source = await readFile(
      new URL(relative, `file://${sourceRoot}/`),
      "utf8",
    );

    expect(source).toContain(route);
    expect(source).toContain('sidebarBehavior="adaptive-canvas"');
    expect(source).toContain("ContentPreviewExclusiveCanvasGate");
    expect(source).toContain("AvatarEffectCreatorPage");
  });
});
