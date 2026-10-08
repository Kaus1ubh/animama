import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("Avatar Effect creator routes", () => {
  it.each([
    ["routes/_app/avatar-effects.new.tsx", "/avatar-effects/new"],
    [
      "routes/_app/avatar-effects.$avatarEffectId.edit.tsx",
      "/avatar-effects/$avatarEffectId/edit",
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

  it("seeds /new from a validated template and keys the page by it", async () => {
    const source = await readFile(
      new URL("routes/_app/avatar-effects.new.tsx", `file://${sourceRoot}/`),
      "utf8",
    );

    expect(source).toContain("validateSearch: parseAvatarEffectTemplateSearch");
    expect(source).toContain("templateId={template}");
    expect(source).toContain('key={`new:${template ?? ""}`}');
  });

  it("keeps the saved-item route free of template search", async () => {
    const source = await readFile(
      new URL(
        "routes/_app/avatar-effects.$avatarEffectId.edit.tsx",
        `file://${sourceRoot}/`,
      ),
      "utf8",
    );

    expect(source).toContain("itemId={avatarEffectId}");
    expect(source).not.toContain("template");
  });
});
