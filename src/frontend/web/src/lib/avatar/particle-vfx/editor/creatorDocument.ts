import { getI18n } from "react-i18next";

import {
  parseParticleVFXRuntimeConfig,
  particleVFXRuntimeSlotConfig,
} from "../runtimeConfig";
import { DEFAULT_IMPORTED_CATALOG_DRAFT } from "./constants";
import { readJsonObject } from "./json";
import type {
  JsonObject,
  ParticleVFXEditorCatalogDraft,
  ParticleVFXEditorDraft,
  ParticleVFXEditorValidationIssue,
} from "./types";

/** The schema of the creator's own Particle Effect document. */
export const PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA =
  "animama/particle-vfx-editor/1";

/**
 * A whole Particle Effect as the creator edits it: its name, description and
 * settings (in the stored `runtime_defaults.slots.particle_vfx` form) and its
 * three.quarks effect. Export offers it and Import accepts it beside plain
 * Quarks JSON, so an effect moves between creators, or is saved by
 * `effects save`, with its settings. Texture references stay relative paths
 * whose files are chosen after import.
 */
export type ParticleVFXCreatorDocument = {
  schema: typeof PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA;
  name: string;
  description: string;
  settings: Record<string, unknown>;
  quarks: JsonObject;
};

/** The creator document of a draft, as Export offers it. */
export function buildParticleVFXCreatorDocument(
  draft: ParticleVFXEditorDraft,
): ParticleVFXCreatorDocument {
  return {
    schema: PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA,
    name: draft.catalog.label,
    description: draft.catalog.description,
    settings: particleVFXRuntimeSlotConfig(draft.catalog),
    quarks: draft.quarksJson,
  };
}

/**
 * Read pasted JSON as a creator document: null when it is not one (plain
 * Quarks JSON), an error when it is incomplete, or else its Quarks effect and
 * the catalog settings it sets.
 */
export function readParticleVFXCreatorDocument(value: JsonObject):
  | {
      quarksJson: JsonObject;
      catalog: Omit<ParticleVFXEditorCatalogDraft, "id" | "assetPath">;
    }
  | ParticleVFXEditorValidationIssue
  | null {
  if (value.schema !== PARTICLE_VFX_CREATOR_DOCUMENT_SCHEMA) return null;
  const quarks = readJsonObject(value.quarks);
  const settings = readJsonObject(value.settings);
  const description = value.description ?? "";
  if (
    !quarks ||
    !settings ||
    typeof value.name !== "string" ||
    typeof description !== "string"
  ) {
    const t = getI18n().getFixedT(null, "particles");
    return {
      severity: "error",
      code: "invalid-json",
      message: t("json.creatorDocumentInvalid"),
      target: "json",
    };
  }
  return {
    quarksJson: quarks,
    catalog: {
      ...parseParticleVFXRuntimeConfig(
        settings,
        DEFAULT_IMPORTED_CATALOG_DRAFT,
      ),
      label: value.name,
      description,
    },
  };
}
