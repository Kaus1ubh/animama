import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { zRuntimeCapabilities } from "../dist/validators.js";

const hosted = JSON.parse(
  await readFile(
    new URL(
      "../../../../../contracts/runtime-capabilities/hosted.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

test("one generated capability contract retains model choices with all six hosted exceptions", () => {
  const capabilities = zRuntimeCapabilities.parse(hosted);
  assert.equal(capabilities.schema_version, 2);
  assert.equal(capabilities.chat, true);
  assert.equal(capabilities.model_selection, true);
  assert.equal(capabilities.model_role_selection, true);
  for (const key of [
    "anima_creation",
    "chat_file_uploads",
    "model_configuration",
    "provider_credentials",
    "local_filesystem_administration",
    "native_features",
  ])
    assert.equal(capabilities[key], false, key);
  assert.equal(capabilities.user_file_processing.enabled, false);
  assert.equal(capabilities.web_search.configuration, false);
  // A configured search service and browser speech availability are separate
  // from the owner's permission to administer connections and credentials.
  assert.equal(capabilities.web_search.configured, true);
  assert.equal(capabilities.offline_speech_enabled, false);
  assert.equal(capabilities.offline_multilingual_speech_enabled, false);
});

test("adapters must report permissions explicitly instead of guessing from runtime kind", () => {
  assert.equal(zRuntimeCapabilities.safeParse(hosted).success, true);
  for (const key of [
    "chat",
    "model_selection",
    "model_role_selection",
    "provider_credentials",
    "local_filesystem_administration",
    "native_features",
  ]) {
    const missing = { ...hosted };
    delete missing[key];
    assert.equal(zRuntimeCapabilities.safeParse(missing).success, false, key);
  }
});
