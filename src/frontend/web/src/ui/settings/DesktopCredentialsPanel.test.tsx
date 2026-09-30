import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CredentialStatus,
  CredentialsBridge,
  ProviderCredentialStatus,
} from "../../../../shared/desktop-runtime";
import { DesktopCredentialFailures } from "./DesktopCredentialsPanel";
import {
  applyCredentialChanges,
  credentialChangesFromDrafts,
} from "./desktop-credential-state";

const configured: ProviderCredentialStatus = {
  provider: "openai",
  configured: true,
  updatedAt: "2026-09-15T00:00:00Z",
  restartRequired: false,
};

function bridge(status = configured): CredentialsBridge {
  return {
    list: vi.fn(async () => [status]),
    apply: vi.fn(async () => [status]),
  };
}

describe("credential failures after product-window recreation", () => {
  it("renders retained failures from main on a fresh view, including another provider", () => {
    const statuses: CredentialStatus[] = [
      configured,
      { ...configured, provider: "elevenlabs", error: "runtime_busy" },
    ];
    const first = renderToStaticMarkup(
      <DesktopCredentialFailures statuses={statuses} />,
    );
    const recreated = renderToStaticMarkup(
      <DesktopCredentialFailures statuses={statuses} />,
    );
    expect(recreated).toBe(first);
    expect(recreated).toContain('role="status"');
    expect(recreated).toContain("ElevenLabs: The key was not changed");
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

  it("does not announce a save as successful when main reports its failure", async () => {
    const current = bridge({ ...configured, error: "runtime_busy" });
    await expect(
      applyCredentialChanges(current, [
        { provider: "openai", value: "fixture-new-key" },
      ]),
    ).rejects.toThrow("credential_change_failed");
  });

  it("does not claim deletion when the configured status remains true", async () => {
    await expect(
      applyCredentialChanges(bridge(), [{ provider: "openai" }]),
    ).rejects.toThrow("credential_change_failed");
  });

  it("accepts a save or removal only after main reports the corresponding saved status", async () => {
    await expect(
      applyCredentialChanges(bridge(), [
        { provider: "openai", value: "fixture-key" },
      ]),
    ).resolves.toEqual([configured]);
    const removed = { ...configured, configured: false, updatedAt: null };
    await expect(
      applyCredentialChanges(bridge(removed), [{ provider: "openai" }]),
    ).resolves.toEqual([removed]);
  });
});

describe("batched API key changes", () => {
  const status = (
    provider: ProviderCredentialStatus["provider"],
    configured: boolean,
    extra: Partial<ProviderCredentialStatus> = {},
  ): CredentialStatus => ({
    provider,
    configured,
    updatedAt: configured ? "2026-09-25T00:00:00Z" : null,
    restartRequired: false,
    ...extra,
  });
  const connection = (
    configured: boolean,
    extra: Partial<CredentialStatus> = {},
  ): CredentialStatus => ({
    connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
    configured,
    updatedAt: configured ? "2026-09-25T00:00:00Z" : null,
    restartRequired: false,
    ...extra,
  });

  it("builds one change per edited provider and ignores blank inputs", () => {
    expect(
      credentialChangesFromDrafts({
        openai: { value: "  fixture-key  " },
        elevenlabs: { value: "   ", remove: true },
      }),
    ).toEqual([
      { provider: "openai", value: "fixture-key" },
      { provider: "elevenlabs" },
    ]);
    expect(
      credentialChangesFromDrafts({
        elevenlabs: { value: "fixture-voice", remove: true },
      }),
    ).toEqual([{ provider: "elevenlabs", value: "fixture-voice" }]);
  });

  it("applies a batch in one call and confirms each saved status", async () => {
    const apply = vi.fn(async () => [
      status("openai", true),
      status("elevenlabs", false),
      connection(true),
    ]);
    const current = { ...bridge(), apply };
    await expect(
      applyCredentialChanges(current, [
        { provider: "openai", value: "fixture-key" },
        { provider: "elevenlabs" },
        {
          connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
          value: "fixture-connection",
        },
      ]),
    ).resolves.toHaveLength(3);
    expect(apply).toHaveBeenCalledOnce();
  });

  it("confirms a removed connection key by its absence", async () => {
    const current = {
      ...bridge(),
      apply: vi.fn(async () => [status("openai", true)]),
    };
    await expect(
      applyCredentialChanges(current, [
        { connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY" },
      ]),
    ).resolves.toHaveLength(1);
    await expect(
      applyCredentialChanges(current, [
        {
          connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
          value: "fixture",
        },
      ]),
    ).rejects.toMatchObject({
      failed: ["ANIMAMA_CONNECTION_C_0123456789AB_API_KEY"],
    });
  });

  it("reports only the keys whose change did not land", async () => {
    const current = {
      ...bridge(),
      apply: vi.fn(async () => [
        status("openai", true),
        status("elevenlabs", true, { error: "runtime_busy" }),
        connection(false, { error: "runtime_busy" }),
      ]),
    };
    await expect(
      applyCredentialChanges(current, [
        { provider: "openai", value: "fixture-key" },
        { provider: "elevenlabs" },
        {
          connection: "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY",
          value: "fixture-connection",
        },
      ]),
    ).rejects.toMatchObject({
      failed: ["elevenlabs", "ANIMAMA_CONNECTION_C_0123456789AB_API_KEY"],
    });
  });
});
