import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CredentialStatus,
  CredentialsBridge,
} from "../../../../shared/desktop-runtime";
import { DesktopCredentialFailures } from "./DesktopCredentialsPanel";
import {
  applyCredentialChange,
  applyCredentialChanges,
  credentialChangesFromDrafts,
} from "./desktop-credential-state";

const configured: CredentialStatus = {
  provider: "openai",
  configured: true,
  updatedAt: "2026-09-15T00:00:00Z",
  restartRequired: false,
};

function bridge(status = configured): CredentialsBridge {
  return {
    list: vi.fn(async () => [status]),
    set: vi.fn(async () => status),
    delete: vi.fn(async () => undefined),
    apply: vi.fn(async () => [status]),
  };
}

describe("credential failures after product-window recreation", () => {
  it("renders retained failures from main on a fresh view, including another provider", () => {
    const statuses: CredentialStatus[] = [
      configured,
      { ...configured, provider: "gemini", error: "runtime_busy" },
    ];
    const first = renderToStaticMarkup(
      <DesktopCredentialFailures statuses={statuses} />,
    );
    const recreated = renderToStaticMarkup(
      <DesktopCredentialFailures statuses={statuses} />,
    );
    expect(recreated).toBe(first);
    expect(recreated).toContain('role="status"');
    expect(recreated).toContain("Gemini: The key was not changed");
    expect(recreated).toContain("Wait, then retry.");
    expect(recreated).not.toContain("Key saved");
  });

  it("shows saved-status recovery guidance without exposing an exception payload", () => {
    const html = renderToStaticMarkup(
      <DesktopCredentialFailures
        statuses={[
          {
            ...configured,
            error: "private exception payload must not be shown",
            restartRequired: true,
          },
        ]}
      />,
    );
    expect(html).toContain("Saved key status is shown above");
    expect(html).toContain("Open runtime recovery");
    expect(html).not.toContain("private exception payload");
    expect(
      renderToStaticMarkup(
        <DesktopCredentialFailures statuses={[configured]} />,
      ),
    ).toBe("");
  });

  it("does not announce a busy save as successful merely because the old runtime is ready", async () => {
    const current = bridge({ ...configured, error: "runtime_busy" });
    await expect(
      applyCredentialChange(current, "openai", "fixture-new-key"),
    ).rejects.toThrow("credential_change_failed");
    expect(current.list).not.toHaveBeenCalled();
  });

  it("respects a failed delete even when the IPC request resolves and old runtime is ready", async () => {
    const current = bridge({ ...configured, error: "runtime_busy" });
    await expect(applyCredentialChange(current, "openai")).rejects.toThrow(
      "credential_change_failed",
    );
    expect(current.delete).toHaveBeenCalledWith("openai");
    expect(current.list).toHaveBeenCalledOnce();
  });

  it("does not claim deletion when the configured status remains true", async () => {
    await expect(applyCredentialChange(bridge(), "openai")).rejects.toThrow(
      "credential_change_failed",
    );
  });

  it("accepts successful set and delete only after main reports the corresponding saved status", async () => {
    const set = bridge();
    await expect(
      applyCredentialChange(set, "openai", "fixture-key"),
    ).resolves.toEqual([configured]);
    const removed = { ...configured, configured: false, updatedAt: null };
    await expect(
      applyCredentialChange(bridge(removed), "openai"),
    ).resolves.toEqual([removed]);
  });
});

describe("batched API key changes", () => {
  const status = (
    provider: CredentialStatus["provider"],
    configured: boolean,
    extra: Partial<CredentialStatus> = {},
  ): CredentialStatus => ({
    provider,
    configured,
    updatedAt: configured ? "2026-09-25T00:00:00Z" : null,
    restartRequired: false,
    ...extra,
  });

  it("builds one change per edited provider and ignores blank inputs", () => {
    expect(
      credentialChangesFromDrafts({
        openai: { value: "  fixture-key  " },
        gemini: { remove: true },
        deepseek: { value: "   " },
        elevenlabs: { value: "fixture-voice", remove: true },
      }),
    ).toEqual([
      { provider: "openai", value: "fixture-key" },
      { provider: "gemini" },
      { provider: "elevenlabs", value: "fixture-voice" },
    ]);
  });

  it("applies a batch in one call and confirms each saved status", async () => {
    const apply = vi.fn(async () => [
      status("openai", true),
      status("gemini", false),
    ]);
    const current = { ...bridge(), apply };
    await expect(
      applyCredentialChanges(current, [
        { provider: "openai", value: "fixture-key" },
        { provider: "gemini" },
      ]),
    ).resolves.toHaveLength(2);
    expect(apply).toHaveBeenCalledOnce();
    expect(current.set).not.toHaveBeenCalled();
  });

  it("reports only the providers whose change did not land", async () => {
    const current = {
      ...bridge(),
      apply: vi.fn(async () => [
        status("openai", true),
        status("gemini", true, { error: "runtime_busy" }),
      ]),
    };
    await expect(
      applyCredentialChanges(current, [
        { provider: "openai", value: "fixture-key" },
        { provider: "gemini" },
      ]),
    ).rejects.toMatchObject({ failed: ["gemini"] });
  });
});
