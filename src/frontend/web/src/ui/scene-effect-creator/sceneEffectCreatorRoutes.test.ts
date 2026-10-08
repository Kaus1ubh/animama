import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL("../../", import.meta.url));
const pageSource = new URL("./SceneEffectCreatorPage.tsx", import.meta.url);

describe("Scene Effect creator routes", () => {
  it.each([
    ["routes/_app/scene-effects/index.tsx", "/scene-effects/"],
    ["routes/_app/scene-effects.new.tsx", "/scene-effects/new"],
    [
      "routes/_app/scene-effects.$sceneEffectId.edit.tsx",
      "/scene-effects/$sceneEffectId/edit",
    ],
  ])("registers %s as a full-canvas creator route", async (relative, route) => {
    const source = await readFile(
      new URL(relative, `file://${sourceRoot}/`),
      "utf8",
    );

    expect(source).toContain(route);
    if (relative.endsWith("index.tsx")) {
      expect(source).toContain('redirect({ to: "/scene-effects/new"');
    } else {
      expect(source).toContain('sidebarBehavior="adaptive-canvas"');
      expect(source).toContain("ContentPreviewExclusiveCanvasGate");
      expect(source).toContain("SceneEffectCreatorPage");
    }
  });

  it("keeps creator preview state isolated from the live Scene store", async () => {
    const source = await readFile(pageSource, "utf8");

    expect(source).toContain("<AvatarPreviewSurface");
    expect(source).toContain("sceneVFX={sceneVFX}");
    expect(source).not.toContain("scene-vfx-store");
    expect(source).not.toContain("useSceneVFXStore");
  });

  it("seeds /new from a validated starting template", async () => {
    const source = await readFile(
      new URL("routes/_app/scene-effects.new.tsx", `file://${sourceRoot}/`),
      "utf8",
    );

    expect(source).toContain("validateSearch: parseSceneEffectTemplateSearch");
    expect(source).toContain("templateId={template}");
    expect(source).toContain('key={`new:${template ?? ""}`}');
  });
});
