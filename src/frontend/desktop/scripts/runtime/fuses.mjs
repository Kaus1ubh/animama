import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Electron's fuse wire: a sentinel, a version byte, a length byte and one byte
 * per fuse, `1` (on) or `0` (off). Packed apps carry exactly `packedFuseWire`,
 * which `electronFuses` in electron-builder.yml sets; the names follow
 * `@electron/fuses`, which does not yet name Electron 45's ninth fuse.
 */
export const fuseSentinel = "dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX";
export const fuseNames = [
  "RunAsNode",
  "EnableCookieEncryption",
  "EnableNodeOptionsEnvironmentVariable",
  "EnableNodeCliInspectArguments",
  "EnableEmbeddedAsarIntegrityValidation",
  "OnlyLoadAppFromAsar",
  "LoadBrowserProcessSpecificV8Snapshot",
  "GrantFileProtocolExtraPrivileges",
  "WasmTrapHandlers",
];
/** Electron 45's defaults; an upgrade that changes them must review this list. */
export const defaultFuseWire = "101100011";
/**
 * Node-as-app, `NODE_OPTIONS`, Node's inspect switches and the file protocol's
 * extra privileges off; cookie encryption, embedded asar integrity validation
 * and app-only-from-asar on; the rest at Electron's default.
 */
export const packedFuseWire = "010011001";

/** The file that holds the wire: the framework binary on macOS, the executable on Windows. */
export function fuseFile(app) {
  return app.endsWith(".app")
    ? path.join(
        app,
        "Contents/Frameworks/Electron Framework.framework/Electron Framework",
      )
    : app;
}

/** The binary holding `app`'s wire, and the offset of its version byte. */
function locateWire(app) {
  const file = fuseFile(app);
  const bytes = readFileSync(file);
  const start = bytes.indexOf(fuseSentinel);
  if (start === -1 || bytes.indexOf(fuseSentinel, start + 1) !== -1)
    throw new Error("Expected exactly one Electron fuse wire");
  const position = start + fuseSentinel.length;
  if (bytes[position] !== 1) throw new Error("Unknown Electron fuse version");
  return { file, bytes, position };
}

/** Read the wire as a string of `0`/`1` (other states are kept as their character). */
export function readFuseWire(app) {
  const { bytes, position } = locateWire(app);
  const length = bytes[position + 1];
  return bytes.subarray(position + 2, position + 2 + length).toString("latin1");
}

/** Name every fuse whose state differs between two wires. */
export function fuseDifferences(actual, expected) {
  if (actual.length !== expected.length)
    return [`wire length ${actual.length} (expected ${expected.length})`];
  return [...expected]
    .map((state, index) =>
      actual[index] === state
        ? null
        : `${fuseNames[index] ?? `fuse ${index}`} ${actual[index]} (expected ${state})`,
    )
    .filter(Boolean);
}

/** Fail unless the packed app at `app` carries exactly `expected`. */
export function assertFuseWire(app, expected = packedFuseWire) {
  const differences = fuseDifferences(readFuseWire(app), expected);
  if (differences.length)
    throw new Error(`Packed app fuse wire differs: ${differences.join(", ")}`);
}

/** Set the wire of the packed app at `app`, in place; the caller re-signs it. */
export function writeFuseWire(app, wire) {
  const { file, bytes, position } = locateWire(app);
  if (bytes[position + 1] !== wire.length)
    throw new Error("Unexpected Electron fuse wire layout");
  bytes.write(wire, position + 2, "latin1");
  writeFileSync(file, bytes);
}

/**
 * The release smoke's journey copy: the packed wire with only Node's inspect
 * switches turned on, so the test driver can attach. A shipped app never
 * carries it.
 */
export function smokeCopyFuseWire(wire = packedFuseWire) {
  const index = fuseNames.indexOf("EnableNodeCliInspectArguments");
  return `${wire.slice(0, index)}1${wire.slice(index + 1)}`;
}
