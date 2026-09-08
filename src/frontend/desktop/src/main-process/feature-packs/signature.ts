import { open } from "node:fs/promises";
import path from "node:path";
import { RuntimeError } from "../runtime/errors.js";
import { runCommand } from "../runtime/processes.js";
import type { PackManifest } from "./catalog.js";
import { verifyPackFiles } from "./files.js";

const DOCUMENT_BUNDLE = "Animama Document Worker.app";
export const DOCUMENT_EXECUTABLE = `${DOCUMENT_BUNDLE}/Contents/MacOS/animama-document-worker`;
const MACHO_MAGICS = new Set([
  0xfeedface, 0xfeedfacf, 0xcafebabe, 0xcafebabf, 0xcefaedfe, 0xcffaedfe,
  0xbebafeca, 0xbfbafeca,
]);

/** Executable packs need both inventory custody and the pinned OS publisher. No unsigned mode. */
export async function verifyExecutablePack(
  root: string,
  manifest: PackManifest,
): Promise<void> {
  if (manifest.id !== "document-processing") return;
  if (
    process.platform !== "darwin" ||
    manifest.platform !== "darwin" ||
    !manifest.signing
  )
    throw new RuntimeError("pack_platform_unavailable");
  await verifyPackFiles(root, manifest);
  if (
    !manifest.files.some(
      (file) => file.path === DOCUMENT_EXECUTABLE && file.mode === "0755",
    )
  )
    throw new RuntimeError("pack_worker_missing");
  const publisher = `anchor apple generic and certificate leaf[subject.OU] = "${manifest.signing.publisher}"`;
  try {
    for (const file of manifest.files) {
      const absolute = path.join(root, file.path);
      const handle = await open(absolute, "r");
      const magic = Buffer.alloc(4);
      let bytesRead: number;
      try {
        ({ bytesRead } = await handle.read(magic, 0, 4, 0));
      } finally {
        await handle.close();
      }
      if (bytesRead === 4 && MACHO_MAGICS.has(magic.readUInt32BE(0)))
        await runCommand(
          "/usr/bin/codesign",
          // '=' makes this literal requirement source, not a filename.
          ["--verify", "--strict", "-R", `=${publisher}`, absolute],
          {},
          root,
        );
    }
    const bundle = path.join(root, DOCUMENT_BUNDLE);
    await runCommand(
      "/usr/bin/codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "-R",
        `=(${publisher}) and (${manifest.signing.requirement})`,
        bundle,
      ],
      {},
      root,
    );
    await runCommand(
      "/usr/sbin/spctl",
      ["--assess", "--type", "execute", bundle],
      {},
      root,
    );
  } catch {
    throw new RuntimeError("pack_signature_invalid");
  }
}
