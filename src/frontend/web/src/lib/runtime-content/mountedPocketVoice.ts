import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import type { MountedPocketVoice } from "@/lib/speech/pocket/anima-voice-selection";
import type { PreparedRuntimeMount } from "./RuntimeMountPreparer";

const unavailableMessage =
  "The selected PocketTTS voice is unavailable. Reload its content to retry.";

function unavailable(message = unavailableMessage): MountedPocketVoice {
  return {
    catalogUrl: null,
    assertActive: () => {
      throw new Error(message);
    },
  };
}

/** Preserve an equipped voice's failure state, while exposing only mount-owned bytes. */
export function resolveMountedPocketVoice(
  issued: PyAnimaRuntime | null,
  mount: PreparedRuntimeMount | null,
): MountedPocketVoice | null {
  if (!issued) return unavailable("Voice content is still loading.");
  const descriptor = issued.content_descriptor;
  const equipped =
    issued.voice != null ||
    descriptor.roots?.some((root) => root.slot_key === "voice") ||
    descriptor.diagnostics?.some(
      (diagnostic) => diagnostic.slot_key === "voice",
    );
  if (!equipped) return null;

  const voice = mount?.data.voice;
  if (
    !mount ||
    mount.isDisposed ||
    mount.data.effective_revision !== issued.effective_revision ||
    !voice ||
    !issued.voice ||
    voice.binding_id !== issued.voice.binding_id
  ) {
    return unavailable();
  }
  const catalogs = (voice.files ?? []).filter(
    (file) =>
      file.role === "pocket_voice_catalog" ||
      (!voice.codec && file.filename.toLowerCase().endsWith(".bin")),
  );
  const catalog = catalogs.length === 1 ? catalogs[0] : undefined;
  const prepared = catalog ? mount.files.get(catalog.file_ref) : undefined;
  if (!catalog || !prepared || catalog.url !== prepared.objectUrl) {
    return unavailable();
  }
  return {
    catalogUrl: prepared.objectUrl,
    assertActive: () => {
      // A cached worker embedding must not outlive the runtime that authorized it.
      if (mount.isDisposed) throw new Error(unavailableMessage);
    },
  };
}
