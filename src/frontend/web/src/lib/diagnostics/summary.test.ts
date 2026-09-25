import { describe, expect, it } from "vitest";

import { buildDiagnosticsSummary } from "./summary";

describe("buildDiagnosticsSummary", () => {
  it("lists only allow-listed facts", () => {
    const summary = buildDiagnosticsSummary({
      appVersion: "0.1.0",
      platform: "darwin",
      runtime: { state: "error", code: "migration_failed" },
      featurePacks: [
        { id: "parakeet-stt", state: "installed", version: "1.2.0" },
      ],
      providers: [
        { provider: "openai", configured: true },
        { provider: "gemini", configured: false },
      ],
    });
    expect(summary).toBe(
      [
        "Animama diagnostics",
        "App version: 0.1.0",
        "Platform: darwin",
        "Runtime: error (migration_failed)",
        "Feature packs:",
        "- parakeet-stt: installed 1.2.0",
        "Provider keys configured:",
        "- openai: yes",
        "- gemini: no",
      ].join("\n"),
    );
  });

  it("never emits extra fields such as key values, paths or messages", () => {
    const input = {
      appVersion: "0.1.0",
      platform: "darwin",
      runtime: {
        state: "error",
        code: "failed",
        backup: "/Users/someone/Library/backup.sql",
      },
      providers: [
        { provider: "openai", configured: true, value: "sk-secret-value" },
      ],
      featurePacks: [
        {
          id: "document-processing",
          state: "failed",
          error: "/private/path/worker.log",
        },
      ],
    };
    const summary = buildDiagnosticsSummary(input);
    expect(summary).not.toMatch(/sk-secret|Users|private|backup|worker\.log/);
  });

  it("strips characters that could smuggle free-form text into identifiers", () => {
    const summary = buildDiagnosticsSummary({
      appVersion: "0.1.0 /Users/someone",
      platform: "darwin",
    });
    expect(summary).toContain("App version: 0.1.0Userssomeone");
    expect(summary).not.toContain("/");
  });
});
