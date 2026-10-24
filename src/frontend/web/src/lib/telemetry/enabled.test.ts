import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeCapabilities } from "@animama/runtime-contracts";
import { hostedCapabilitiesFixture } from "@/app/runtime/runtime-fixture";

const build = vi.hoisted(() => ({ mode: "production", disabled: false }));
vi.mock("@/platform/env", () => ({
  env: {
    get mode() {
      return build.mode;
    },
    get disableWebuiTelemetry() {
      return build.disabled;
    },
    disableWebuiTraces: false,
  },
}));

const { browserTelemetryPath } = await import("./enabled");

function capabilities(
  overrides: Partial<RuntimeCapabilities> = {},
): RuntimeCapabilities {
  return {
    ...hostedCapabilitiesFixture,
    browser_telemetry: { path: "/api/telemetry" },
    ...overrides,
  };
}

afterEach(() => {
  build.mode = "production";
  build.disabled = false;
  vi.unstubAllGlobals();
});

describe("browser telemetry enablement", () => {
  it("is off unless the runtime advertises the capability", () => {
    expect(browserTelemetryPath(hostedCapabilitiesFixture)).toBeNull();
    expect(
      browserTelemetryPath(capabilities({ browser_telemetry: null })),
    ).toBeNull();
  });

  it("uses the advertised same-origin path, defaulting to the local forwarder's", () => {
    expect(browserTelemetryPath(capabilities())).toBe("/api/telemetry");
    expect(browserTelemetryPath(capabilities({ browser_telemetry: {} }))).toBe(
      "/api/telemetry",
    );
    expect(
      browserTelemetryPath(
        capabilities({ browser_telemetry: { path: "/v1/hosted/telemetry" } }),
      ),
    ).toBe("/v1/hosted/telemetry");
  });

  it("refuses any path that could leave the origin or carry data", () => {
    for (const path of [
      "https://collector.example/v1",
      "//collector.example/v1",
      "api/telemetry",
      "/api/../telemetry",
      "/api/telemetry/",
      "/api/telemetry?signal=logs",
      "/api\\telemetry",
      `/${"a".repeat(128)}`,
    ])
      expect(
        browserTelemetryPath(capabilities({ browser_telemetry: { path } })),
      ).toBeNull();
  });

  it("lets the build-time switch win over the capability", () => {
    build.disabled = true;
    expect(browserTelemetryPath(capabilities())).toBeNull();
  });

  it("never enables the embedded desktop app, whatever its runtime reports", () => {
    build.mode = "embedded-desktop";
    expect(browserTelemetryPath(capabilities())).toBeNull();
    build.mode = "production";
    expect(
      browserTelemetryPath(capabilities({ runtime_kind: "desktop" })),
    ).toBeNull();
    vi.stubGlobal("window", { animamaDesktop: { isDesktop: true } });
    expect(browserTelemetryPath(capabilities())).toBeNull();
  });
});
