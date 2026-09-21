"use client";

import Color from "color";
import { X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  ColorPicker,
  ColorPickerAlpha,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/ui/theme/color-picker";
import { Button } from "@/ui/components/button";
import { DIALOG_BACKDROP_CLASS_NAME } from "@/ui/components/dialog";
import { useCustomTheme } from "@/ui/theme/custom-theme";
import { type ThemeVarName } from "@/ui/theme/tokens";

const THEME_GROUPS: Array<{ title: string; keys: ThemeVarName[] }> = [
  {
    title: "Primary Colors",
    keys: ["--primary", "--primary-foreground"],
  },
  {
    title: "Secondary Colors",
    keys: ["--secondary", "--secondary-foreground"],
  },
  {
    title: "Accent Colors",
    keys: ["--accent", "--accent-foreground"],
  },
  {
    title: "Base Colors",
    keys: [
      "--background",
      "--foreground",
      "--muted",
      "--muted-foreground",
      "--border",
      "--input",
    ],
  },
  {
    title: "Sidebar Colors",
    keys: [
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-primary-foreground",
      "--sidebar-accent",
      "--sidebar-accent-foreground",
    ],
  },
];

const formatLabel = (value: ThemeVarName) => {
  return value
    .replace(/^--/, "")
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const formatColor = (value: string) => {
  try {
    return Color(value).hex().toLowerCase();
  } catch {
    return value;
  }
};

const rgbaToHsl = (rgba: number[]) => {
  const [r, g, b, a] = rgba;
  return Color.rgb(r, g, b).alpha(a).hsl().string();
};

type CustomThemeModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const CustomThemeModal = ({
  open,
  onOpenChange,
}: CustomThemeModalProps) => {
  const { vars, load, resetToCurrent, updateVar } = useCustomTheme();
  const [activeVar, setActiveVar] = useState<ThemeVarName | null>(null);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const closeModal = useCallback(() => {
    setActiveVar(null);
    onOpenChange(false);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
    };
  }, [open, closeModal]);

  const sections = useMemo(() => THEME_GROUPS, []);

  if (!open) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-[200] flex items-center justify-center p-4",
        DIALOG_BACKDROP_CLASS_NAME,
      )}
      onClick={closeModal}
    >
      <div
        className="bg-card dark:bg-card max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl border p-4 shadow-xl"
        role="dialog"
        aria-modal="true"
        onClick={(event) => {
          event.stopPropagation();
          setActiveVar(null);
        }}
      >
        <div className="flex items-start justify-between border-b pb-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">Custom Theme</h2>
            <p className="text-muted-foreground dark:text-muted-foreground text-sm">
              Adjust colors for this theme.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={closeModal}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mt-4 space-y-4">
          {sections.map((section, index) => (
            <details
              key={section.title}
              open={index < 2}
              className="bg-muted/30 dark:bg-muted/30 rounded-xl border p-3"
            >
              <summary className="cursor-pointer text-sm font-medium">
                {section.title}
              </summary>
              <div className="mt-3 space-y-3">
                {section.keys.map((key) => {
                  const rawValue = vars[key] ?? "#000000";
                  const displayValue = formatColor(rawValue);
                  const isActive = activeVar === key;

                  return (
                    <div key={key} className="space-y-2">
                      <div className="text-muted-foreground dark:text-muted-foreground text-xs font-medium">
                        {formatLabel(key)}
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          className={cn(
                            "bg-background flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left",
                            "hover:bg-accent/40 dark:bg-background dark:hover:bg-accent/40",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            setActiveVar(isActive ? null : key);
                          }}
                        >
                          <span
                            className="h-6 w-6 rounded-md border"
                            style={{ backgroundColor: rawValue }}
                          />
                          <div className="text-foreground dark:text-foreground h-8 flex-1 text-xs">
                            {displayValue}
                          </div>
                        </button>

                        {isActive && (
                          <div
                            className="bg-popover dark:bg-popover absolute top-full left-0 z-20 mt-2 w-[260px] rounded-xl border p-3 shadow-xl"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <ColorPicker
                              key={key}
                              defaultValue={rawValue}
                              onChange={(rgba) => {
                                if (Array.isArray(rgba)) {
                                  updateVar(key, rgbaToHsl(rgba));
                                }
                              }}
                            >
                              <div className="grid gap-3">
                                <ColorPickerSelection className="h-28" />
                                <ColorPickerHue />
                                <ColorPickerAlpha />
                                <div className="flex items-center gap-2">
                                  <ColorPickerEyeDropper />
                                  <ColorPickerOutput />
                                  <ColorPickerFormat className="flex-1" />
                                </div>
                              </div>
                            </ColorPicker>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </details>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => resetToCurrent()}
          >
            Reset to current
          </Button>
          <Button type="button" onClick={closeModal}>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
