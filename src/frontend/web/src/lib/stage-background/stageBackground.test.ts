import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  STAGE_SCENES,
  appStageBackgroundUrl,
  resolveStageBackground,
  stageSceneChoice,
  stageSceneToSave,
} from "./stageBackground";

describe("stage background", () => {
  it("uses the chosen scene's themed image when nothing is bound", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        scene: "sakura",
        variant: "chat",
        theme: "light",
      }),
    ).toEqual({ kind: "app", src: "/background/sakura-light.webp" });
    expect(appStageBackgroundUrl("cafe", "dark")).toBe(
      "/background/cafe-dark.webp",
    );
  });

  it("always shows the Dreamy pedestal on the Anima page", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(
        resolveStageBackground({
          hasBoundImage: true,
          scene: "none",
          variant: "showcase",
          theme,
        }),
      ).toEqual({
        kind: "app",
        src: `/background/dreamy-pedestal-${theme}.webp`,
      });
    }
  });

  it("draws nothing when the Anima chose no background", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        scene: "none",
        variant: "chat",
        theme: "light",
      }),
    ).toEqual({ kind: "none" });
  });

  it("prefers a bound image over any scene choice", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: true,
        scene: "none",
        variant: "chat",
        theme: "dark",
      }),
    ).toEqual({ kind: "bound" });
  });

  it("reads the stored choice and defaults by theme", () => {
    expect(stageSceneChoice(null, "light")).toBe("dreamy");
    expect(stageSceneChoice(null, "dark")).toBe("sakura");
    expect(
      stageSceneChoice({ presentation: { stage_background: "x" } }, "dark"),
    ).toBe("sakura");
    expect(
      stageSceneChoice(
        { presentation: { stage_background: "dreamy" } },
        "dark",
      ),
    ).toBe("dreamy");
    expect(
      stageSceneChoice(
        { presentation: { stage_background: "seaside" } },
        "light",
      ),
    ).toBe("seaside");
    expect(
      stageSceneChoice({ presentation: { stage_background: "none" } }, "light"),
    ).toBe("none");
  });

  it("stores a picked scene, even the current theme's default", () => {
    expect(stageSceneToSave(undefined, null)).toBeNull();
    expect(stageSceneToSave("dreamy", null)).toBe("dreamy");
    expect(stageSceneToSave("sakura", {})).toBe("sakura");
    expect(
      stageSceneToSave("seaside", {
        presentation: { stage_background: "seaside" },
      }),
    ).toBeNull();
    expect(
      stageSceneToSave("none", { presentation: { stage_background: "cafe" } }),
    ).toBe("none");
  });

  it("ships light and dark images for every scene", async () => {
    const files = [
      "dreamy-pedestal-light",
      "dreamy-pedestal-dark",
      ...STAGE_SCENES.flatMap((id) => [`${id}-light`, `${id}-dark`]),
    ];
    await Promise.all(
      files.map((file) =>
        access(
          new URL(`../../../public/background/${file}.webp`, import.meta.url),
        ),
      ),
    );
  });
});
