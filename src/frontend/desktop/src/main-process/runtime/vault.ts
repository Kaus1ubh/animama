import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import {
  credentialProviders,
  type CredentialProvider,
  type CredentialStatus,
} from "../../../../shared/desktop-runtime.js";
import path from "node:path";
import { atomicWrite, privateDirectory } from "./atomic-file.js";
import { RuntimeError } from "./errors.js";

export type Encryption = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};
type VaultData = {
  version: 1;
  postgresPassword: string;
  providers: Partial<
    Record<CredentialProvider, { value: string; updatedAt: string }>
  >;
};
const providerEnvironment: Record<CredentialProvider, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  huggingface: "HF_TOKEN",
  gemini: "GEMINI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
};

export function validateProvider(value: unknown): CredentialProvider {
  if (
    typeof value !== "string" ||
    !credentialProviders.includes(value as CredentialProvider)
  )
    throw new RuntimeError("credential_provider_invalid");
  return value as CredentialProvider;
}
/**
 * Validate a renderer-supplied batch: 1..N changes, one per provider, each an
 * object with only `provider` and an optional `value`.
 */
export function validateCredentialChanges(
  value: unknown,
): Array<{ provider: CredentialProvider; value?: string }> {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > credentialProviders.length
  )
    throw new RuntimeError("credential_changes_invalid");
  const seen = new Set<CredentialProvider>();
  return value.map((change: unknown) => {
    if (
      !change ||
      typeof change !== "object" ||
      Array.isArray(change) ||
      Object.keys(change).some((key) => key !== "provider" && key !== "value")
    )
      throw new RuntimeError("credential_changes_invalid");
    const record = change as { provider?: unknown; value?: unknown };
    const provider = validateProvider(record.provider);
    if (seen.has(provider))
      throw new RuntimeError("credential_changes_invalid");
    seen.add(provider);
    return record.value === undefined
      ? { provider }
      : { provider, value: validateCredential(record.value) };
  });
}
export function validateCredential(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 8192 ||
    /[\x00-\x20\x7f]/u.test(value)
  )
    throw new RuntimeError("credential_value_invalid");
  return value;
}

/** Only main can decrypt. Public methods return configured/missing status. */
export class CredentialVault {
  private data: VaultData;
  constructor(
    private file: string,
    private encryption: Encryption,
    databaseExists: boolean,
  ) {
    if (!encryption.isEncryptionAvailable())
      throw new RuntimeError("secure_storage_unavailable");
    privateDirectory(path.dirname(file));
    if (existsSync(file)) {
      try {
        const stat = lstatSync(file);
        if (
          !stat.isFile() ||
          stat.isSymbolicLink() ||
          stat.nlink !== 1 ||
          (stat.mode & 0o777) !== 0o600 ||
          stat.size > 128 * 1024
        )
          throw new Error();
        const data = JSON.parse(
          encryption.decryptString(readFileSync(file)),
        ) as VaultData;
        if (
          data.version !== 1 ||
          !/^[a-f0-9]{64}$/u.test(data.postgresPassword) ||
          !data.providers ||
          typeof data.providers !== "object"
        )
          throw new Error();
        for (const [name, entry] of Object.entries(data.providers)) {
          validateProvider(name);
          validateCredential(entry.value);
          if (
            typeof entry.updatedAt !== "string" ||
            !Number.isFinite(Date.parse(entry.updatedAt))
          )
            throw new Error();
        }
        this.data = data;
      } catch {
        throw new RuntimeError("vault_unreadable");
      }
    } else {
      if (databaseExists) throw new RuntimeError("vault_missing_for_database");
      this.data = {
        version: 1,
        postgresPassword: randomBytes(32).toString("hex"),
        providers: {},
      };
      this.save(this.data);
    }
  }
  private save(next: VaultData): void {
    if (!this.encryption.isEncryptionAvailable())
      throw new RuntimeError("secure_storage_unavailable");
    atomicWrite(this.file, this.encryption.encryptString(JSON.stringify(next)));
    this.data = next;
  }
  databasePassword(): string {
    return this.data.postgresPassword;
  }
  childEnvironment(): Record<string, string> {
    return Object.fromEntries(
      Object.entries(this.data.providers).map(([provider, entry]) => [
        providerEnvironment[provider as CredentialProvider],
        entry.value,
      ]),
    );
  }
  list(): CredentialStatus[] {
    return credentialProviders.map((provider) => ({
      provider,
      configured: Boolean(this.data.providers[provider]),
      updatedAt: this.data.providers[provider]?.updatedAt ?? null,
      restartRequired: false,
    }));
  }
  set(provider: CredentialProvider, value: string): void {
    validateProvider(provider);
    validateCredential(value);
    this.save({
      ...this.data,
      providers: {
        ...this.data.providers,
        [provider]: { value, updatedAt: new Date().toISOString() },
      },
    });
  }
  delete(provider: CredentialProvider): void {
    this.apply([{ provider }]);
  }
  /**
   * Set or remove several providers in one encrypted write, so a batch is
   * all-or-nothing on disk (an omitted value removes that provider's key).
   */
  apply(
    changes: ReadonlyArray<{ provider: CredentialProvider; value?: string }>,
  ): void {
    const providers = { ...this.data.providers };
    const updatedAt = new Date().toISOString();
    for (const change of changes) {
      validateProvider(change.provider);
      if (change.value === undefined) delete providers[change.provider];
      else
        providers[change.provider] = {
          value: validateCredential(change.value),
          updatedAt,
        };
    }
    this.save({ ...this.data, providers });
  }
}
