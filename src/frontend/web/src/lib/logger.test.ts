import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each test loads a fresh module so the build level and the recent-entry
// buffer start from that test's environment.
async function loadLogger(build: "development" | "production") {
  vi.stubEnv("DEV", build === "development");
  vi.resetModules();
  return import("./logger");
}

describe("createLogger", () => {
  beforeEach(() => {
    for (const method of ["debug", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation(() => {});
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints only warnings and errors in a production build", async () => {
    const { createLogger } = await loadLogger("production");
    const logger = createLogger("[Test]");
    const failure = new Error("failed");

    logger.debug("Category", "debug line");
    logger.info("Category", "info line");
    logger.warn("Category", "warn line", { count: 1 });
    logger.error("Category", "error line", failure);

    expect(console.debug).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringMatching(/ - Test\] Category: warn line$/),
      { count: 1 },
    );
    expect(console.error).toHaveBeenCalledWith(
      expect.stringMatching(/ - Test\] Category: error line$/),
      failure,
    );
  });

  it("prints every level in a development build", async () => {
    const { createLogger } = await loadLogger("development");
    const logger = createLogger("Test");

    logger.debug("Category", "debug line");
    logger.info("Category", "info line", { count: 1 });

    expect(console.debug).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(/ - Test\] Category: info line$/),
      { count: 1 },
    );
  });

  it("remembers warnings and errors without their data", async () => {
    const { createLogger, recentLogEntries } = await loadLogger("production");
    const logger = createLogger("Test");

    logger.info("Chat", "Info is not remembered", { text: "hello" });
    logger.warn("Chat", "Request retried", {
      text: "private words",
      error: new TypeError("/Users/someone/file"),
    });
    logger.error("Chat", "Request failed", new RangeError("private words"));

    expect(recentLogEntries()).toEqual([
      expect.objectContaining({
        level: "warn",
        source: "Test",
        category: "Chat",
        message: "Request retried",
        errorName: "TypeError",
      }),
      expect.objectContaining({
        level: "error",
        message: "Request failed",
        errorName: "RangeError",
      }),
    ]);
    expect(JSON.stringify(recentLogEntries())).not.toMatch(
      /private words|someone|hello/,
    );
  });

  it("remembers milestones apart from problems and prints them as info", async () => {
    const { createLogger, recentLogEntries, recentMilestones } =
      await loadLogger("development");
    const logger = createLogger("Voice");

    logger.milestone("State", "Started voice mode (parakeet)", {
      turnId: "turn-1",
    });
    logger.warn("State", "Microphone busy");

    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(
        / - Voice\] State: Started voice mode \(parakeet\)$/,
      ),
      { turnId: "turn-1" },
    );
    expect(recentMilestones()).toEqual([
      {
        time: expect.any(Number),
        source: "Voice",
        category: "State",
        message: "Started voice mode (parakeet)",
      },
    ]);
    expect(recentLogEntries()).toEqual([
      expect.objectContaining({ message: "Microphone busy" }),
    ]);
  });

  it("keeps the last 50 milestones in a production build without printing them", async () => {
    const { createLogger, recentMilestones } = await loadLogger("production");
    const logger = createLogger("Chat");

    for (let index = 0; index < 60; index += 1) {
      logger.milestone("Turn", `Chat turn ${index}`);
    }

    expect(console.info).not.toHaveBeenCalled();
    const milestones = recentMilestones();
    expect(milestones).toHaveLength(50);
    expect(milestones[0]?.message).toBe("Chat turn 10");
    expect(milestones.at(-1)?.message).toBe("Chat turn 59");
  });

  it("keeps only the most recent entries", async () => {
    const { createLogger, recentLogEntries } = await loadLogger("production");
    const logger = createLogger("Test");

    for (let index = 0; index < 40; index += 1) {
      logger.warn("Loop", `Warning ${index}`);
    }

    const entries = recentLogEntries();
    expect(entries).toHaveLength(30);
    expect(entries[0]?.message).toBe("Warning 10");
    expect(entries.at(-1)?.message).toBe("Warning 39");
  });
});
