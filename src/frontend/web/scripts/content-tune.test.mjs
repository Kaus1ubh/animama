import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_TUNE_PORT, parseTuneArgs } from "./content-tune.mjs";

test("reads the catalog from the option or the environment", () => {
  assert.equal(
    parseTuneArgs([], { ANIMAMA_WOW_SOUND_CATALOG: "/sounds" }).catalogDir,
    "/sounds",
  );
  assert.equal(
    parseTuneArgs(["--catalog", "/other"], {
      ANIMAMA_WOW_SOUND_CATALOG: "/sounds",
    }).catalogDir,
    "/other",
  );
  assert.equal(parseTuneArgs([], {}).catalogDir, null);
});

test("collects sound roots, the Avatar, the port and --no-open", () => {
  const options = parseTuneArgs(
    [
      "--sounds",
      "a",
      "--sounds",
      "b",
      "--avatar",
      "caitlyn",
      "--port",
      "8790",
      "--no-open",
    ],
    {},
  );
  assert.deepEqual(options.soundRoots, ["a", "b"]);
  assert.equal(options.avatar, "caitlyn");
  assert.equal(options.port, 8790);
  // A fixed default port keeps applied edits across restarts.
  assert.equal(parseTuneArgs([], {}).port, DEFAULT_TUNE_PORT);
  assert.equal(options.open, false);
  // Without --sounds, the checkout's pack input is the default.
  assert.match(
    parseTuneArgs([], {}).soundRoots[0],
    /build-inputs\/wow-comedy-sfx$/,
  );
});

test("refuses unknown options and bad values", () => {
  assert.throws(() => parseTuneArgs(["--avatar", "bob"], {}), /--avatar/);
  assert.throws(() => parseTuneArgs(["--port", "x"], {}), /--port/);
  assert.throws(() => parseTuneArgs(["--catalog"], {}), /needs a value/);
  assert.throws(() => parseTuneArgs(["--nope"], {}), /Unknown option/);
});
