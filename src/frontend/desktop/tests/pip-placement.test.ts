import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  readPipPlacement,
  resolveCornerPipBounds,
  resolveSavedPipBounds,
  writePipPlacement,
} from "../src/main-process/pip/pip-placement.js";

const workArea = { x: 0, y: 25, width: 1440, height: 875 };
const size = { width: 210, height: 280 };

describe("PiP placement file", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    // The private-directory walk refuses links such as macOS's /var.
    directory = mkdtempSync(path.join(realpathSync(tmpdir()), "animama-pip-"));
    file = path.join(directory, "pip-placement.json");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it("reads back the placement it saved", () => {
    const placement = { displayId: 7, x: 100, y: 200, sizeScale: 0.7 };
    writePipPlacement(file, placement);
    expect(readPipPlacement(file)).toEqual(placement);
  });

  it("ignores a missing, malformed or other-version file", () => {
    expect(readPipPlacement(file)).toBeNull();
    writeFileSync(file, "not json");
    expect(readPipPlacement(file)).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ version: 2, displayId: 1, x: 0, y: 0, sizeScale: 1 }),
    );
    expect(readPipPlacement(file)).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ version: 1, displayId: 1, x: "0", y: 0, sizeScale: 1 }),
    );
    expect(readPipPlacement(file)).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ version: 1, displayId: 1, x: 0.5, y: 0, sizeScale: 1 }),
    );
    expect(readPipPlacement(file)).toBeNull();
  });
});

describe("resolveSavedPipBounds", () => {
  it("restores the saved position on its display", () => {
    expect(
      resolveSavedPipBounds(
        { displayId: 1, x: 300, y: 400, sizeScale: 0.5 },
        [{ id: 1, workArea }],
        size,
      ),
    ).toEqual({ x: 300, y: 400, ...size });
  });

  it("keeps the window inside a work area that has shrunk", () => {
    expect(
      resolveSavedPipBounds(
        { displayId: 1, x: 1400, y: 0, sizeScale: 0.5 },
        [{ id: 1, workArea }],
        size,
      ),
    ).toEqual({ x: 1230, y: 25, ...size });
  });

  it("gives up when the saved display is disconnected", () => {
    expect(
      resolveSavedPipBounds(
        { displayId: 2, x: 300, y: 400, sizeScale: 0.5 },
        [{ id: 1, workArea }],
        size,
      ),
    ).toBeNull();
  });
});

describe("resolveCornerPipBounds", () => {
  it("sits flush with the bottom-right corner of the work area", () => {
    expect(resolveCornerPipBounds(workArea, size)).toEqual({
      x: 1230,
      y: 620,
      ...size,
    });
  });
});
