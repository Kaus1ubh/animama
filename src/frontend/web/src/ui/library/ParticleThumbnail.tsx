import { useId } from "react";
import { useQuery } from "@tanstack/react-query";
import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import { particleThumbnailColor } from "@/lib/content/particleThumbnailColor";
import { AvatarImage } from "@/ui/components/avatar";

/** Multiply texture RGB by the emitter tint while preserving texture alpha. */
export function ParticleThumbnail({
  src,
  source,
}: {
  src: string;
  source: NonNullable<PyCatalogViewItem["particle_thumbnail"]>;
}) {
  const id = `particle-tint-${useId().replace(/:/g, "")}`;
  const { data: color } = useQuery({
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
      <AvatarImage
        src={src}
        alt=""
        className="object-contain p-1"
        style={color ? { filter: `url(#${id})` } : undefined}
      />
    </>
  );
}
