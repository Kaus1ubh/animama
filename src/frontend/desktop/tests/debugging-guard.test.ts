import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  debuggingSwitches,
  refusesDebugging,
} from "../src/main-process/security/debugging-switches.js";

const host = vi.hoisted(() => ({
  isPackaged: true,
  inspectorUrl: undefined as string | undefined,
  switches: new Set<string>(),
  exit: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {
    get isPackaged() {
      return host.isPackaged;
    },
    exit: host.exit,
    commandLine: { hasSwitch: (name: string) => host.switches.has(name) },
  },
}));
vi.mock("node:inspector", () => ({ url: () => host.inspectorUrl }));

/** Import the guard afresh; a refusal holds the import until the exit lands. */
async function loadGuard(): Promise<"loaded" | "held"> {
  vi.resetModules();
  const loaded = import("../src/main-process/security/debugging-guard.js").then(
    () => "loaded" as const,
  );
  const held = new Promise<"held">((resolve) =>
    // Generous, so a slow import under load is not mistaken for a hold.
    setTimeout(() => resolve("held"), 2000),
  );
  return Promise.race([loaded, held]);
}

afterEach(() => {
  host.isPackaged = true;
  host.inspectorUrl = undefined;
  host.switches.clear();
  host.exit.mockReset();
});

describe("debugging switches", () => {
  const options = (argv: string[], switches: string[] = []) => ({
    isPackaged: true,
    inspectorUrl: undefined,
    argv: ["/Applications/Animama.app/Contents/MacOS/Animama", ...argv],
    hasSwitch: (name: string) => switches.includes(name),
  });

  it.each(debuggingSwitches.flatMap((name) => [`--${name}`, `--${name}=0`]))(
    "a packaged app refuses %s",
    (arg) => {
      expect(refusesDebugging(options([arg]))).toBe(true);
    },
  );

  it("reads Chromium's own switch parser as well as the arguments", () => {
    // Chromium also accepts a single-dash spelling that argv shows differently.
    expect(
      refusesDebugging(
        options(["-remote-debugging-port=0"], ["remote-debugging-port"]),
      ),
    ).toBe(true);
  });

  it("allows ordinary arguments, unpackaged development and a running inspector", () => {
    expect(refusesDebugging(options(["--inspector-free", "--lang=ja"]))).toBe(
      false,
    );
    expect(
      refusesDebugging({ ...options(["--inspect"]), isPackaged: false }),
    ).toBe(false);
    expect(
      refusesDebugging({
        ...options(["--inspect=0"]),
        inspectorUrl: "ws://127.0.0.1:9229/x",
      }),
    ).toBe(false);
  });
});

describe("debugging guard", () => {
  it("exits a packaged app before the rest of start-up runs", async () => {
    host.switches.add("remote-debugging-port");

    expect(await loadGuard()).toBe("held");
    expect(host.exit).toHaveBeenCalledWith(1);
  });

  it("lets start-up continue without a switch, unpackaged or with a running inspector", async () => {
    expect(await loadGuard()).toBe("loaded");
    host.switches.add("inspect");
    host.isPackaged = false;
    expect(await loadGuard()).toBe("loaded");
    host.isPackaged = true;
    host.inspectorUrl = "ws://127.0.0.1:9229/x";
    expect(await loadGuard()).toBe("loaded");
    expect(host.exit).not.toHaveBeenCalled();
  });

  it("is the first module main.ts imports", () => {
    const main = readFileSync(
      new URL("../src/main.ts", import.meta.url),
      "utf8",
    );
    const firstImport = main.match(/^import\b[^;]*;/mu)?.[0];
    expect(firstImport).toBe(
      'import "./main-process/security/debugging-guard.js";',
    );
  });
});
