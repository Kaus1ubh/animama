/** Small synthetic catalog fixtures: no real owners, delivery URLs, or provider calls. */
import type {
  AnimaCreationOptions,
  ItemRevisionRef,
  SourceRevision,
} from "@animama/runtime-contracts/sdk";
import {
  type CreateAnimaDraft,
  createAnimaDraftReducer,
  emptyReactions,
  newCreateAnimaDraft,
} from "./createAnimaDraft";

export const ref = (id: string, revision = "a"): ItemRevisionRef => ({
  item_id: id,
  revision_sha256: revision.repeat(64),
});
export const revision = (
  kind: SourceRevision["kind"],
  value = "a",
): SourceRevision => ({
  kind,
  revision_sha256: value.repeat(64),
});

export function creationOptions(): AnimaCreationOptions {
  return {
    schema_version: 1,
    limits: {
      display_name_max_characters: 40,
      identity_max_bytes: 32768,
      avatar_max_bytes: 104857600,
      image_max_bytes: 16777216,
      image_max_dimension: 8192,
      image_max_pixels: 40000000,
      source_max_items: 1000,
      source_max_bytes: 1073741824,
      runtime_config_max_bytes: 1048576,
    },
    starter_pack: {
      id: "builtin:starter-loadout",
      version: 1,
      revision_sha256: "b".repeat(64),
    },
    recommended: { gestures: [], reactions: emptyReactions() },
    counts: {
      recommended_gestures: 0,
      recommended_reaction_cells: 0,
      recommended_reactions: 0,
      available_gestures: 0,
      available_reaction_cells: 0,
      available_reactions: 0,
    },
    expected_source_revisions: {},
    diagnostics: [],
  };
}

export function readyDraft(): CreateAnimaDraft {
  const draft = createAnimaDraftReducer(newCreateAnimaDraft(), {
    type: "seed",
    options: creationOptions(),
  });
  return {
    ...draft,
    voice: {
      provider: "pocket_tts",
      pocket: { type: "preset", voice_id: "eve" },
      elevenlabs_voice_id: null,
    },
    avatar: ref("avatar"),
    display_name: "  Rowan 🌿  ",
    identity_markdown: "# Rowan\r\n\r\nA curious companion.  \r\n",
    meaningful: true,
    evidence: {
      avatar: {
        source: ref("avatar"),
        revisions: { avatar: revision("avatar") },
      },
    },
  };
}
