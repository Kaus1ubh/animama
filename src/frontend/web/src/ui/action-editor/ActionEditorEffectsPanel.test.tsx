import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import type { PyPose } from "@animama/runtime-contracts/api-types";
import { ActionEditorEffectsPanel } from "./ActionEditorEffectsPanel";
import type { ActionDependencySection } from "./ActionEditorWorkspaceContext";

vi.mock("@/ui/sound-upload/SoundUploadButton", () => ({
  SoundUploadButton: () => <button>Upload</button>,
}));

const particle: PyCatalogViewItem = {
  item_id: "particle-1",
  name: "Hearts",
  description: null,
  catalog_source: "included",
  origin: "builtin",
  source: {
    type: "builtin",
    content_id: "hearts",
    version: 1,
  },
  state: "ready",
  created_at: null,
  updated_at: null,
};

const sections: ActionDependencySection[] = [
  {
    label: "Particle Effects",
    contentType: "particle_effect",
    items: [particle],
    isPending: false,
    errorMessage: null,
    hasNextPage: true,
    isFetchingNextPage: false,
    fetchNextPage: async () => undefined,
    retry: async () => undefined,
  },
  {
    label: "Avatar Effects",
    contentType: "avatar_effect",
    items: [],
    isPending: false,
    errorMessage: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: async () => undefined,
    retry: async () => undefined,
  },
  {
    label: "Scene Effects",
    contentType: "scene_effect",
    items: [],
    isPending: false,
    errorMessage: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: async () => undefined,
    retry: async () => undefined,
  },
  {
    label: "Sound Effects",
    contentType: "sound_effect",
    items: [],
    isPending: false,
    errorMessage: null,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: async () => undefined,
    retry: async () => undefined,
  },
];

const savedPose: PyPose = {
  item_id: "friendly-wave",
  name: "Friendly Wave",
  kind: "pose",
  source: "local",
  pose_id: "wave",
  revision_sha256: "rev",
  editable: true,
};

describe("ActionEditorEffectsPanel", () => {
  it("offers upload and separate sound preview and explicit insertion", () => {
    const html = renderToString(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="sound_effect"
        onActiveTypeChange={() => undefined}
        sections={sections.map((section) =>
          section.contentType === "sound_effect"
            ? { ...section, items: [{ ...particle, name: "Pop" }] }
            : section,
        )}
        dependencies={[]}
        onAdd={() => undefined}
      />,
    );
    expect(html).toContain(">Upload<");
    expect(html).toContain('aria-label="Play Pop"');
    expect(html).toContain('aria-label="Add Pop to timeline"');
  });
  it("shows Local Poses before Effects for Gesture authoring, hiding Included ones", () => {
    const html = renderToString(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="particle_effect"
        onActiveTypeChange={() => undefined}
        sections={sections}
        dependencies={[]}
        onAdd={() => undefined}
        poses={[
          savedPose,
          {
            ...savedPose,
            item_id: "included",
            source: "included",
            name: "Starter",
            editable: false,
          },
        ]}
        onAddPose={() => undefined}
        onEditPose={() => undefined}
      />,
    );

    expect(html).toContain("Poses &amp; Effects");
    expect(html.indexOf(">Poses<")).toBeLessThan(html.indexOf(">Particle FX<"));
    expect(html).toContain('placeholder="Search poses"');
    expect(html).toContain("Friendly Wave");
    expect(html).toContain("Local");
    // Included Poses stay hidden until "Show Included" is checked.
    expect(html).toContain("Show Included");
    expect(html).not.toContain('aria-label="Edit Starter"');
    expect(html).toContain('aria-label="Edit Friendly Wave"');
    expect(html.indexOf('aria-label="Edit Friendly Wave"')).toBeLessThan(
      html.indexOf('aria-label="Insert Friendly Wave at current playhead"'),
    );
    expect(html).toContain(
      'aria-label="Insert Friendly Wave at current playhead"',
    );
  });

  it("renders a tabbed metadata-first catalog without thumbnails", () => {
    const html = renderToString(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="particle_effect"
        onActiveTypeChange={() => undefined}
        sections={sections}
        dependencies={[
          {
            alias: "hearts",
            content_type: "particle_effect",
            source: particle.source!,
          },
        ]}
        onAdd={() => undefined}
      />,
    );

    expect(html).toContain("Effects");
    expect(html).toContain("Particle FX");
    expect(html).toContain("Avatar FX");
    expect(html).toContain("Scene FX");
    expect(html).toContain("SFX");
    expect(html).toContain('placeholder="Search particle effects"');
    expect(html).toContain("Hearts");
    expect(html).not.toContain("Added to timeline ·");
    expect(html).toContain("Added");
    expect(html).toContain('aria-label="Add Hearts at current playhead"');
    expect(html).not.toContain("<img");
  });

  it("keeps the collapsed effect count and integrated expansion control", () => {
    const html = renderToString(
      <ActionEditorEffectsPanel
        expanded={false}
        onExpandedChange={() => undefined}
        query=""
        onQueryChange={() => undefined}
        activeType="particle_effect"
        onActiveTypeChange={() => undefined}
        sections={sections}
        dependencies={[
          {
            alias: "hearts",
            content_type: "particle_effect",
            source: particle.source!,
          },
        ]}
        onAdd={() => undefined}
      />,
    );

    expect(html).toContain("1 added");
    expect(html).toContain('aria-label="Expand effects"');
    expect(html).not.toContain("Search particle effects");
  });

  it("renders the selected category and distinguishes loading, errors, and empties", () => {
    const loading = renderToString(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="sound_effect"
        onActiveTypeChange={() => undefined}
        sections={sections.map((section) =>
          section.contentType === "sound_effect"
            ? { ...section, isPending: true }
            : section,
        )}
        dependencies={[]}
        onAdd={() => undefined}
      />,
    );
    expect(loading).toContain('placeholder="Search sound effects"');
    expect(loading).toContain("Loading");
    expect(loading).toContain("sound effects");
    expect(loading).not.toContain("No effects found");

    const failed = renderToString(
      <ActionEditorEffectsPanel
        query=""
        onQueryChange={() => undefined}
        activeType="avatar_effect"
        onActiveTypeChange={() => undefined}
        sections={sections.map((section) =>
          section.contentType === "avatar_effect"
            ? { ...section, errorMessage: "Catalog unavailable" }
            : section,
        )}
        dependencies={[]}
        onAdd={() => undefined}
      />,
    );
    expect(failed).toContain("Could not load");
    expect(failed).toContain("avatar effects");
    expect(failed).toContain("Catalog unavailable");
    expect(failed).toContain("Try again");
    expect(failed).not.toContain("No effects found");
  });
});
