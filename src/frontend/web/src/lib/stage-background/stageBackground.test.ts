import { describe, expect, it } from "vitest";

import {
  appStageBackgroundUrl,
  isStageBackgroundDisabled,
  resolveStageBackground,
} from "./stageBackground";

describe("stage background", () => {
  it("uses the themed app image when nothing is bound", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        disabled: false,
        variant: "chat",
        theme: "light",
      }),
    ).toEqual({ kind: "app", src: "/background/stage-day.webp" });
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        disabled: false,
        variant: "chat",
        theme: "dark",
      }),
    ).toEqual({ kind: "app", src: "/background/stage-night.webp" });
    expect(appStageBackgroundUrl("showcase", "light")).toBe(
      "/background/stage-pedestal.webp",
    );
  });

  it("draws nothing when the Anima turned the background off", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: false,
        disabled: true,
        variant: "showcase",
        theme: "light",
      }),
    ).toEqual({ kind: "none" });
  });

  it("prefers a bound image over the app image and the off switch", () => {
    expect(
      resolveStageBackground({
        hasBoundImage: true,
        disabled: true,
        variant: "chat",
        theme: "dark",
      }),
    ).toEqual({ kind: "bound" });
  });

  it("reads only an explicit off switch", () => {
    expect(isStageBackgroundDisabled(null)).toBe(false);
    expect(isStageBackgroundDisabled({ presentation: {} })).toBe(false);
    expect(
      isStageBackgroundDisabled({ presentation: { disable_background: true } }),
    ).toBe(true);
  });
});
