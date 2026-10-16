"use client";

import { useState } from "react";

import {
  AVATAR_SHADER_IDS,
  AVATAR_SHADER_LABELS,
  useAvatarShaderStore,
} from "@/lib/avatar/toon-shader/avatarShader";
import {
  AVATAR_SHADER_LOOK_CONTROLS,
  useAvatarShaderLookStore,
} from "@/lib/avatar/toon-shader/avatarShaderLook";
import { Button } from "@/ui/components/button";
import { Slider } from "@/ui/components/slider";

/** Switches the experimental Avatar toon shader; each switch reloads the Avatar. */
export function AvatarShaderDebugSection() {
  const shader = useAvatarShaderStore((state) => state.shader);
  const setShader = useAvatarShaderStore((state) => state.setShader);

  return (
    <div className="space-y-1.5">
      <div
        className="flex flex-wrap gap-1"
        role="group"
        aria-label="Avatar shader"
      >
        {AVATAR_SHADER_IDS.map((id) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={id === shader ? "secondary" : "ghost"}
            aria-pressed={id === shader}
            onClick={() => setShader(id)}
            className="text-2xs h-7 px-2"
          >
            {AVATAR_SHADER_LABELS[id]}
          </Button>
        ))}
      </div>
      <div className="text-muted-foreground text-2xs">
        Reloads the Avatar. Tuned colours come from VRoid material names, so
        other models may look off. lilToon uses only the first directional
        light, and VRM material-colour expressions do not apply to it.
      </div>
      <AvatarShaderLookControls toonShaderActive={shader !== "mtoon"} />
    </div>
  );
}

/** Live look multipliers; values persist in this browser. */
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
        Changes apply live. Exposure covers every Avatar canvas and the lights
        cover the chat canvas, under any shader. Shadow, rim and outline adjust
        MToon tuned and lilToon only.
      </div>
    </div>
  );
}
