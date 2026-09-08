import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const hubSource = new URL("./CreateHubPage.tsx", import.meta.url);
const sidebarSource = new URL(
  "../sidebar/SidebarCreateMenu.tsx",
  import.meta.url,
);

describe("Effect creator entry points", () => {
  it.each([
    ["Avatar VFX", "/a/avatar-effects/new"],
    ["Scene VFX", "/a/scene-effects/new"],
  ])("links %s from the creator hub and sidebar", async (label, route) => {
    const [hub, sidebar] = await Promise.all([
      readFile(hubSource, "utf8"),
      readFile(sidebarSource, "utf8"),
    ]);

    expect(hub).toContain(`title: "${label}"`);
    expect(hub).toContain(`to: "${route}"`);
    expect(sidebar).toContain(`label: "${label}"`);
    expect(sidebar).toContain(`to: "${route}"`);
  });

  it("groups Effect destinations behind a second sidebar menu level", async () => {
    const sidebar = await readFile(sidebarSource, "utf8");

    expect(sidebar).toContain("const PRIMARY_CREATE_LINKS");
    expect(sidebar).toContain("const EFFECT_CREATE_LINKS");
    expect(sidebar).toContain("setEffectsOpen(true)");
    expect(sidebar).toContain('aria-label="Effects"');
  });
});

describe("direct Anima creation entry points", () => {
  it.each([
    ["creator hub", "./CreateHubPage.tsx"],
    ["sidebar Create menu", "../sidebar/SidebarCreateMenu.tsx"],
    ["management carousel callback", "../../routes/a/animas/$animaId.tsx"],
    ["Library Avatar handoff", "../library/LibraryContentInventory.tsx"],
    [
      "Anima-required preview recovery",
      "../content-preview/ContentPreviewHost.tsx",
    ],
    ["empty owned-roster resolver", "../../routes/a/animas/index.tsx"],
  ])(
    "keeps the %s pointed at the owner-scoped creator",
    async (_label, path) => {
      const source = await readFile(new URL(path, import.meta.url), "utf8");

      expect(source).toContain('"/a/animas/new"');
      expect(source).not.toContain("useCreateAnima");
      expect(source).not.toContain("createAnimaV1AnimasPost");
    },
  );

  it.each([
    "./CreateAnimaPage.tsx",
    "./CreateAnimaVoiceCloneSection.tsx",
    "../../query/mutations/useCreateAnima.ts",
  ])("removes the obsolete creation-only module %s", async (path) => {
    await expect(access(new URL(path, import.meta.url))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("replaces the notice with the new feature without restoring old modules", async () => {
    const source = await readFile(
      new URL("../../routes/a/animas.new.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("@/ui/create-anima/CreateAnimaPage");
    expect(source).toContain("parseCreateAnimaSearch");
    expect(source).not.toContain("AnimaCreationUnavailablePage");
  });

  it("preserves the local VRM preview owned by the portrait-debug route", async () => {
    const [route, preview] = await Promise.all([
      readFile(
        new URL("../../routes/a/avatar-portrait-debug.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("./CreateAnimaAvatarPreview.tsx", import.meta.url),
        "utf8",
      ),
    ]);

    expect(route).toContain("<CreateAnimaAvatarPreview");
    expect(preview).toContain("@/ui/create/CreateAnimaAvatarPreviewScene");
    await expect(
      access(new URL("./CreateAnimaAvatarPreviewScene.tsx", import.meta.url)),
    ).resolves.toBeUndefined();
  });
});
