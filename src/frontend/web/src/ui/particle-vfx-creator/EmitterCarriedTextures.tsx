import { AlertTriangle, ImagePlus } from "lucide-react";
import { useId, useRef, type ChangeEvent } from "react";

import type {
  ParticleVFXEditorTextureFile,
  ParticleVFXEmitterDraft,
} from "@/lib/avatar/particle-vfx";
import { PARTICLE_TEXTURE_LIMITS } from "@/lib/effects/effectArtLimits";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/components/button";

function basename(reference: string): string {
  return reference.split("/").at(-1) ?? reference;
}

/** A hidden PNG picker behind an ordinary button. */
function PngFileButton({
  label,
  disabled,
  onFile,
}: {
  label: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onFile(file);
  };
  return (
    <>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/png"
        className="hidden"
        aria-label={label}
        disabled={disabled}
        onChange={choose}
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="size-4" />
        {label}
      </Button>
    </>
  );
}

/**
 * Textures this effect carries itself: imported PNGs and the texture files of
 * the saved effect. The active emitter can use one, import a new PNG, or
 * supply the file for a texture it refers to that has no bytes yet.
 */
export function EmitterCarriedTextures({
  emitter,
  textureFiles,
  textureUrls,
  missingReferences,
  error,
  busy,
  onSelect,
  onImport,
  onSupply,
}: {
  emitter: ParticleVFXEmitterDraft;
  textureFiles: Readonly<Record<string, ParticleVFXEditorTextureFile>>;
  textureUrls: ReadonlyMap<string, string>;
  missingReferences: readonly string[];
  error: string | null;
  busy: boolean;
  onSelect: (reference: string) => void;
  onImport: (file: File) => void;
  onSupply: (reference: string, file: File) => void;
}) {
  const references = Object.keys(textureFiles).sort();
  const emitterMissing =
    emitter.textureUrl && missingReferences.includes(emitter.textureUrl)
      ? emitter.textureUrl
      : null;
  return (
    <section className="grid gap-2" aria-label="This effect's textures">
      <div className="text-muted-foreground text-xs font-semibold uppercase">
        This effect&apos;s textures
      </div>
      {emitterMissing ? (
        <div
          role="alert"
          className="border-destructive/40 bg-destructive/5 flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm"
        >
          <AlertTriangle className="text-destructive size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Texture {basename(emitterMissing)} is missing. Choose its PNG file.
          </span>
          <PngFileButton
            label={`Choose file for ${basename(emitterMissing)}`}
            disabled={busy}
            onFile={(file) => onSupply(emitterMissing, file)}
          />
        </div>
      ) : null}
      {references.length ? (
        <div className="grid grid-cols-2 gap-2">
          {references.map((reference) => {
            const file = textureFiles[reference]!;
            return (
              <button
                key={reference}
                type="button"
                className={cn(
                  "border-border hover:bg-muted/60 flex items-center gap-3 rounded-md border p-2 text-left text-sm transition-colors",
                  !emitter.textureId &&
                    emitter.textureUrl === reference &&
                    "border-primary bg-primary/10",
                )}
                onClick={() => onSelect(reference)}
              >
                <span className="bg-muted flex size-10 shrink-0 items-center justify-center rounded border">
                  {textureUrls.get(reference) ? (
                    <img
                      src={textureUrls.get(reference)}
                      alt=""
                      className="max-h-8 max-w-8 object-contain"
                    />
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {basename(reference)}
                  </span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {file.width}×{file.height}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <PngFileButton
          label="Import PNG texture"
          disabled={busy}
          onFile={onImport}
        />
        <span className="text-muted-foreground text-xs">
          PNG up to {PARTICLE_TEXTURE_LIMITS.bytes / (1024 * 1024)} MiB and{" "}
          {PARTICLE_TEXTURE_LIMITS.dimension} px. Set Atlas tiles for a sprite
          sheet.
        </span>
      </div>
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </section>
  );
}
