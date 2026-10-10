import { renderToStaticMarkup } from "@/test/runtime-markup";
import { describe, expect, it } from "vitest";

import type { LibrarySharingFlow } from "@/lib/content-sharing/types";

import { ContentExportReview } from "./ContentExportReview";

function flow(omitted: { kind: string; name: string }[]): LibrarySharingFlow {
  return {
    exportReview: {
      selected_count: 1,
      required_count: 0,
      manifest: {
        root_entry_ids: ["effect"],
        entries: [
          {
            package_entry_id: "effect",
            display_name: "Sweat Drop",
            kind: "avatar_effect",
          },
        ],
      },
    },
    summary: { omitted },
    downloadStarted: false,
    notice: null,
    error: null,
  } as unknown as LibrarySharingFlow;
}

describe("ContentExportReview", () => {
  it("says built-in effects' licensed sounds stay with this app", () => {
    const markup = renderToStaticMarkup(
      <ContentExportReview
        flow={flow([
          { kind: "sound_effect", name: "Pop" },
          { kind: "sound_effect", name: "Ding" },
        ])}
      />,
    );
    expect(markup).toContain("2 built-in effect sounds stay with this app.");
    expect(markup).not.toContain("Ding");
  });

  it("says nothing when no sound is left out", () => {
    expect(
      renderToStaticMarkup(<ContentExportReview flow={flow([])} />),
    ).not.toContain("effect sound");
  });
});
