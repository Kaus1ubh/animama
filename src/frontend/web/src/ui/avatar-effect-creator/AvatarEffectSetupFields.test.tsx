import { renderToStaticMarkup } from "@/test/runtime-markup";
import { describe, expect, it, vi } from "vitest";

import { createDefaultAvatarEffectDocument } from "@/lib/avatar/vfx/editor";

import { NO_AVATAR_EFFECT_IMAGES } from "./avatarEffectCreatorBehavior";
import { AvatarEffectSetupFields } from "./AvatarEffectSetupFields";

vi.mock("@/ui/sound-upload/SoundUploadButton", () => ({
  SoundUploadButton: () => null,
}));

/** The note for a copy without its built-in effect's licensed sound. */
const LICENSED_SOUND_NOTE =
  "The built-in sound plays only with the built-in effect, so this copy has no sound. You can choose one of your own.";

function fields(input: { licensedSoundOmitted: boolean }): string {
  return renderToStaticMarkup(
    <AvatarEffectSetupFields
      document={createDefaultAvatarEffectDocument()}
      imageResources={NO_AVATAR_EFFECT_IMAGES}
      imageBusy={null}
      imageError={null}
      invalidField={null}
      soundOptions={[]}
      soundPending={false}
      licensedSoundOmitted={input.licensedSoundOmitted}
      onDispatch={() => undefined}
      onChooseImage={() => undefined}
      onClearOtherEyeImage={() => undefined}
    />,
  );
}

describe("AvatarEffectSetupFields", () => {
  it("explains a built-in effect's licensed sound that stayed behind", () => {
    const markup = fields({ licensedSoundOmitted: true });
    expect(markup).toContain(LICENSED_SOUND_NOTE);
    expect(markup).toContain(
      'aria-describedby="avatar-effect-licensed-sound-note"',
    );
  });

  it("shows no note for an ordinary draft", () => {
    expect(fields({ licensedSoundOmitted: false })).not.toContain(
      LICENSED_SOUND_NOTE,
    );
  });
});
