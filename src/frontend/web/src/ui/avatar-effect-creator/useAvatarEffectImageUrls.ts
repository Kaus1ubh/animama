import { useEffect, useRef, useState } from "react";

import { createAvatarEffectObjectUrlLease } from "./avatarEffectCreatorBehavior";

type UrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
type Lease = { url: string; dispose: () => void };

/** Object URLs for the creator's image files. */
export type AvatarEffectImageUrls = {
  image: string | null;
  otherEyeImage: string | null;
};

/**
 * Object URLs for the effect's image files. A file's URL is made after the
 * render that brings the file, so an edit can apply the new document with the
 * old file's URL first. An old URL is therefore revoked only once its
 * replacement is in use: that load finishes or is superseded instead of
 * failing on a revoked URL. Every URL is revoked on unmount.
 */
export function useAvatarEffectImageUrls(
  imageFile: File | null,
  otherEyeFile: File | null,
  api: UrlApi = URL,
): AvatarEffectImageUrls {
  const [urls, setUrls] = useState<AvatarEffectImageUrls>({
    image: null,
    otherEyeImage: null,
  });
  const leases = useRef<Lease[]>([]);
  // The URLs made for the current files, kept until state holds them.
  const latest = useRef(new Set<string>());

  useEffect(() => {
    const image = imageFile
      ? createAvatarEffectObjectUrlLease(imageFile, api)
      : null;
    const otherEyeImage = otherEyeFile
      ? createAvatarEffectObjectUrlLease(otherEyeFile, api)
      : null;
    latest.current = new Set();
    for (const lease of [image, otherEyeImage]) {
      if (!lease) continue;
      leases.current.push(lease);
      latest.current.add(lease.url);
    }
    setUrls({
      image: image?.url ?? null,
      otherEyeImage: otherEyeImage?.url ?? null,
    });
  }, [api, imageFile, otherEyeFile]);

  useEffect(() => {
    const current = new Set([urls.image, urls.otherEyeImage]);
    leases.current = leases.current.filter((lease) => {
      if (current.has(lease.url) || latest.current.has(lease.url)) return true;
      lease.dispose();
      return false;
    });
  }, [urls]);

  useEffect(
    () => () => {
      for (const lease of leases.current) lease.dispose();
      leases.current = [];
    },
    [],
  );

  return urls;
}
