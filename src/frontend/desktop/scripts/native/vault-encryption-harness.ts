import { app, safeStorage } from "electron";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RuntimeError } from "../../src/main-process/runtime/errors.js";
import { CredentialVault } from "../../src/main-process/runtime/vault.js";

/**
 * Exercise the credential vault with the operating system's real protected
 * storage (DPAPI on Windows, Keychain on macOS). The runner passes a disposable
 * folder for both the vault and Electron's profile, and removes it afterwards.
 * On macOS, safeStorage still adds an "Electron Safe Storage" Keychain item.
 */
const root = process.argv.at(-1);
if (!root || !path.isAbsolute(root))
  throw new Error("usage: vault-encryption-harness <disposable folder>");
app.setPath("userData", path.join(root, "electron"));

function check(root: string): void {
  const file = path.join(root, "secrets", "vault.bin");
  const providerKey = "harness-provider-key";
  if (!safeStorage.isEncryptionAvailable())
    throw new Error("protected storage is unavailable");
  const vault = new CredentialVault(file, safeStorage, false);
  vault.set("openai", providerKey);
  const reopened = new CredentialVault(file, safeStorage, true);
  if (reopened.databasePassword() !== vault.databasePassword())
    throw new Error("the database password did not survive reopening");
  if (reopened.childEnvironment().OPENAI_API_KEY !== providerKey)
    throw new Error("the provider key did not survive reopening");
  const bytes = readFileSync(file).toString("latin1");
  if (bytes.includes(providerKey) || bytes.includes(vault.databasePassword()))
    throw new Error("the vault file contains plaintext secrets");
  writeFileSync(file, Buffer.from("not an encrypted vault"));
  try {
    new CredentialVault(file, safeStorage, true);
    throw new Error("a corrupt vault was accepted");
  } catch (error) {
    if (!(error instanceof RuntimeError) || error.code !== "vault_unreadable")
      throw error;
  }
}

void app.whenReady().then(() => {
  try {
    check(root);
    process.stdout.write("vault encryption: OK\n");
    app.exit(0);
  } catch (error) {
    process.stderr.write(`vault encryption failed: ${String(error)}\n`);
    app.exit(1);
  }
});
