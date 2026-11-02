import { describe, expect, it } from "vitest";

import { buildDiagnosticsSummary } from "./summary";

describe("buildDiagnosticsSummary", () => {
  it("lists only allow-listed facts", () => {
    const summary = buildDiagnosticsSummary({
      appVersion: "0.1.0",
      platform: "darwin",
      runtime: { state: "error", code: "migration_failed" },
      featurePacks: [
        { id: "document-processing", state: "installed", version: "1.2.0" },
      ],
      providers: [
        { provider: "openai", configured: true },
        { provider: "elevenlabs", configured: false },
      ],
    });
    expect(summary).toBe(
      [
        "Animama diagnostics",
        "App version: 0.1.0",
        "Platform: darwin",
        "Runtime: error (migration_failed)",
        "Feature packs:",
        "- document-processing: installed 1.2.0",
        "Provider keys configured:",
        "- openai: yes",
        "- elevenlabs: no",
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

  it("lists recent warnings and errors without paths, URLs or addresses", () => {
    const summary = buildDiagnosticsSummary({
      appVersion: "0.1.0",
      platform: "web",
      recentProblems: [
        {
          time: Date.UTC(2026, 9, 29, 17, 3, 4, 250),
          level: "warn",
          source: "Avatar",
          category: "Animation",
          message: "Failed to load animation",
          errorName: "TypeError",
        },
        {
          time: Date.UTC(2026, 9, 29, 17, 4, 0),
          level: "error",
          source: "Uploads",
          category: "File",
          message:
            "Could not read /Users/someone/notes.txt from https://example.test/a?token=abc for a@b.test",
        },
      ],
    });
    expect(summary.split("\n").slice(3)).toEqual([
      "Recent warnings and errors:",
      "- 2026-10-29T17:03:04Z warn Avatar / Animation: Failed to load animation (TypeError)",
      "- 2026-10-29T17:04:00Z error Uploads / File: Could not read (omitted) from (omitted) for (omitted)",
    ]);
    expect(summary).not.toMatch(/someone|example|token|a@b/);
  });

  it("lists recent activity before problems", () => {
    const summary = buildDiagnosticsSummary({
      appVersion: "0.1.0",
      platform: "web",
      recentActivity: [
        {
          time: Date.UTC(2026, 9, 29, 17, 2, 0),
          source: "Chat",
          category: "Turn",
          message: "Chat turn started",
        },
        {
          time: Date.UTC(2026, 9, 29, 17, 2, 5),
          source: "Settings",
          category: "UserSettings",
          message: "Saved user settings: preferences, /Users/someone",
        },
      ],
      recentProblems: [
        {
          time: Date.UTC(2026, 9, 29, 17, 3, 4),
          level: "warn",
          source: "Avatar",
          category: "Animation",
          message: "Failed to load animation",
        },
      ],
    });
    expect(summary.split("\n").slice(3)).toEqual([
      "Recent activity:",
      "- 2026-10-29T17:02:00Z Chat / Turn: Chat turn started",
      "- 2026-10-29T17:02:05Z Settings / UserSettings: Saved user settings: preferences, (omitted)",
      "Recent warnings and errors:",
      "- 2026-10-29T17:03:04Z warn Avatar / Animation: Failed to load animation",
    ]);
  });
});
