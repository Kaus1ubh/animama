"use client";

import { useState } from "react";

import {
  AVATAR_SHADER_IDS,
  AVATAR_SHADER_LABELS,
  useAvatarShaderStore,
} from "@/lib/avatar/toon-shader/avatarShader";
import {
  AVATAR_SHADER_LOOK_CONTROLS,
  AVATAR_SHADER_LOOK_PRESETS,
  AVATAR_TONE_MAPPINGS,
  useAvatarShaderLookStore,
  type AvatarToneMapping,
} from "@/lib/avatar/toon-shader/avatarShaderLook";
import {
  LIL_TOON_PRESETS,
  LIL_TOON_PRESET_LABELS,
} from "@/lib/avatar/toon-shader/lilToonLook";
import { Button } from "@/ui/components/button";
import { Slider } from "@/ui/components/slider";

const TONE_MAPPING_LABELS: Record<AvatarToneMapping, string> = {
  aces: "ACES",
  neutral: "Neutral",
};

/** A labelled row of pressed-state buttons. */
function ButtonRow({
  label,
  options,
}: {
  label: string;
  options: {
    id: string;
    label: string;
    pressed: boolean;
    onClick: () => void;
  }[];
}) {
  return (
    <div className="space-y-1">
      <div className="text-2xs">{label}</div>
      <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            key={option.id}
            type="button"
            size="sm"
            variant={option.pressed ? "secondary" : "ghost"}
            aria-pressed={option.pressed}
            onClick={option.onClick}
            className="text-2xs h-7 px-2"
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/** Switches the experimental Avatar toon shader; each switch reloads the Avatar. */
export function AvatarShaderDebugSection() {
  const shader = useAvatarShaderStore((state) => state.shader);
  const setShader = useAvatarShaderStore((state) => state.setShader);

  return (
    <div className="space-y-1.5">
      <ButtonRow
        label="Shader"
        options={AVATAR_SHADER_IDS.map((id) => ({
          id,
          label: AVATAR_SHADER_LABELS[id],
          pressed: id === shader,
          onClick: () => setShader(id),
        }))}
      />
      <div className="text-muted-foreground text-2xs">
        Reloads the Avatar. Tuned colours come from VRoid material names, so
        other models may look off. lilToon uses only the first directional
        light, and VRM material-colour expressions do not apply to it.
      </div>
      <AvatarShaderLookControls toonShaderActive={shader !== "mtoon"} />
    </div>
  );
}

/** Live look presets, renderer toggles and sliders; they persist in this browser. */
function AvatarShaderLookControls({
  toonShaderActive,
}: {
  toonShaderActive: boolean;
}) {
  const look = useAvatarShaderLookStore((state) => state.look);
  const setLook = useAvatarShaderLookStore((state) => state.setLook);
  const resetLook = useAvatarShaderLookStore((state) => state.resetLook);
  const [copied, setCopied] = useState(false);

  const copyValues = async () => {
    const text = JSON.stringify(look);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      console.info("Avatar shader look", text);
    }
  };

  return (
    <div className="space-y-2 pt-1">
      <ButtonRow
        label="Look preset"
        options={LIL_TOON_PRESETS.map((id) => ({
          id,
          label: LIL_TOON_PRESET_LABELS[id],
          pressed: id === look.lilToonPreset,
          onClick: () => setLook(AVATAR_SHADER_LOOK_PRESETS[id]),
        }))}
      />
      <ButtonRow
        label="Tone mapping"
        options={AVATAR_TONE_MAPPINGS.map((id) => ({
          id,
          label: TONE_MAPPING_LABELS[id],
          pressed: id === look.toneMapping,
          onClick: () => setLook({ toneMapping: id }),
        }))}
      />
      <ButtonRow
        label="Canvas filters (chat)"
        options={[
          {
            id: "softGrade",
            label: "Soft grade",
            pressed: look.softGrade,
            onClick: () => setLook({ softGrade: !look.softGrade }),
          },
          {
            id: "edgeGlow",
            label: "Edge glow",
            pressed: look.edgeGlow,
            onClick: () => setLook({ edgeGlow: !look.edgeGlow }),
          },
        ]}
      />
      {AVATAR_SHADER_LOOK_CONTROLS.map(
        ({ key, label, min, max, step, toonOnly }) => {
          const disabled = toonOnly && !toonShaderActive;
          return (
            <div key={key} className="space-y-1">
              <div className="text-2xs flex justify-between">
                <span className={disabled ? "text-muted-foreground" : ""}>
                  {label}
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {look[key].toFixed(2)}
                </span>
              </div>
              <Slider
                min={min}
                max={max}
                step={step}
                value={[look[key]]}
                disabled={disabled}
                onValueChange={([value]) =>
                  setLook({ [key]: value ?? look[key] })
                }
                thumbProps={{ "aria-label": label }}
              />
            </div>
          );
        },
      )}
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={resetLook}
          className="text-2xs h-7 px-2"
        >
          Reset look
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void copyValues()}
          className="text-2xs h-7 px-2"
        >
          {copied ? "Copied" : "Copy values"}
        </Button>
      </div>
      <div className="text-muted-foreground text-2xs">
        Changes apply live. A preset sets the lilToon recipe plus the lighting,
        tone mapping and filters that go with it; each stays adjustable.
        Exposure and tone mapping cover every Avatar canvas, the lights and
        filters the chat canvas, under any shader. Shadow, rim and outline
        adjust MToon tuned and lilToon only.
      </div>
    </div>
  );
}
