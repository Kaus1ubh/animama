export type AvatarBackgroundOption = {
  id: string;
  label: string;
  imageSrc: string;
  thumbnailSrc: string;
  width: number;
  height: number;
};

/** Downloaded examples are not distributed. Anima backgrounds continue to
 * resolve from the mounted typed content catalog, including owner imports.
 */
export const AVATAR_BACKGROUND_OPTIONS: AvatarBackgroundOption[] = [];

const avatarBackgroundOptionsById = new Map(
  AVATAR_BACKGROUND_OPTIONS.map((option) => [option.id, option]),
);

export function getAvatarBackgroundOption(
  backgroundId: string | null | undefined,
): AvatarBackgroundOption | null {
  if (!backgroundId) return null;
  return avatarBackgroundOptionsById.get(backgroundId) ?? null;
}
