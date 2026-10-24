import { type ReactNode, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { particleThumbnailColor } from "@/lib/content/particleThumbnailColor";
import { LibraryThumbnailImage } from "./LibraryThumbnailImage";

/**
 * Multiply texture RGB by the emitter tint while preserving texture alpha. The
 * manifest that holds the tint is read only once the lazily loaded texture has
 * drawn, so off-screen tiles fetch neither.
 */
export function ParticleThumbnail({
  src,
  source,
  fallback,
}: {
  src: string;
  source: NonNullable<PyCatalogViewItem["particle_thumbnail"]>;
  fallback: ReactNode;
}) {
  const id = `particle-tint-${useId().replace(/:/g, "")}`;
  const [loaded, setLoaded] = useState(false);
  const { data: color, isError } = useQuery({
    queryKey: [
      "particle-thumbnail-color",
      source.manifestUrl,
      source.revision,
      source.texturePath,
    ],
    queryFn: async ({ signal }) => {
      const response = await fetch(source.manifestUrl, { signal });
      if (!response.ok) throw new Error("Particle thumbnail color unavailable");
      return particleThumbnailColor(await response.json(), source.texturePath);
    },
    enabled: loaded,
    staleTime: Infinity,
    retry: false,
  });
  return (
    <>
      {color ? (
        <svg aria-hidden="true" width="0" height="0" className="absolute">
          <defs>
            <filter id={id} colorInterpolationFilters="sRGB">
              <feColorMatrix
                type="matrix"
                values={`${color.r} 0 0 0 0 0 ${color.g} 0 0 0 0 0 ${color.b} 0 0 0 0 0 1 0`}
              />
            </filter>
          </defs>
        </svg>
      ) : null}
      {/* An untinted texture never flashes before its tint is known. */}
      <LibraryThumbnailImage
        src={src}
        fallback={fallback}
        className="object-contain p-1"
        style={color ? { filter: `url(#${id})` } : undefined}
        ready={color !== undefined || isError}
        onLoad={() => setLoaded(true)}
      />
    </>
  );
}
