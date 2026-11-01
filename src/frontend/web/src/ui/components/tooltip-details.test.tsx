import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipDetails, TooltipLabel } from "@/ui/components/tooltip";

describe("tooltip details", () => {
  it("puts each detail on its own smaller line under the title", () => {
    const html = renderToStaticMarkup(
      <TooltipDetails
        title="Voice mode"
        lines={["STT: Parakeet CPU", "TTS: ElevenLabs"]}
      />,
    );
    expect(html).toBe(
      '<span class="flex flex-col gap-0.5"><span>Voice mode</span>' +
        '<span class="text-2xs opacity-80">STT: Parakeet CPU</span>' +
        '<span class="text-2xs opacity-80">TTS: ElevenLabs</span></span>',
    );
  });

  it("renders the title alone without details", () => {
    expect(renderToStaticMarkup(<TooltipDetails title="Dictate" />)).toBe(
      "Dictate",
    );
  });
});

describe("tooltip label", () => {
  it("puts the shortcut in a keycap after the label", () => {
    const html = renderToStaticMarkup(
      <TooltipLabel label="Dictate" shortcut="⌃⌥D" />,
    );
    expect(html).toMatch(/<span>Dictate<\/span><kbd [^>]*>⌃⌥D<\/kbd>/u);
  });

  it("renders the label alone without a shortcut", () => {
    expect(
      renderToStaticMarkup(<TooltipLabel label="Dictate" shortcut={null} />),
    ).toBe("Dictate");
  });
});
