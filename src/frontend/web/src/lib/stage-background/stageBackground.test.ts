import { access } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  STAGE_SCENES,
  appStageBackgroundUrl,
  resolveStageBackground,
  stageSceneChoice,
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
    expect(appStageBackgroundUrl("cafe", "chat", "dark")).toBe(
      "/background/cafe-dark.webp",
    );
  });

  it("gives the light Dreamy showcase its pedestal image", () => {
    expect(appStageBackgroundUrl("dreamy", "showcase", "light")).toBe(
      "/background/dreamy-pedestal.webp",
    );
    expect(appStageBackgroundUrl("dreamy", "showcase", "dark")).toBe(
      "/background/dreamy-dark.webp",
    );
  });

  it("draws nothing when the Anima chose no background", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        scene: "none",
        variant: "showcase",
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

  it("reads the stored choice and defaults unknown values to Dreamy", () => {
    expect(stageSceneChoice(null)).toBe("dreamy");
    expect(stageSceneChoice({ presentation: { stage_background: "x" } })).toBe(
      "dreamy",
    );
    expect(
      stageSceneChoice({ presentation: { stage_background: "seaside" } }),
    ).toBe("seaside");
    expect(
      stageSceneChoice({ presentation: { stage_background: "none" } }),
    ).toBe("none");
  });

  it("ships light and dark images for every scene", async () => {
    const files = [
      "dreamy-pedestal",
      ...STAGE_SCENES.flatMap(({ id }) => [`${id}-light`, `${id}-dark`]),
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
