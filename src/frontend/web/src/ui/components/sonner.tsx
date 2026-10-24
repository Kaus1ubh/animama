"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, type ToasterProps } from "sonner";

/** Map Animama theme names onto the themes whose rich-color tokens Sonner defines. */
export function resolveSonnerTheme(theme: string): ToasterProps["theme"] {
  return theme === "dark" || theme === "system" ? theme : "light";
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { t } = useTranslation("components");
  const { theme = "system", forcedTheme } = useTheme();

  return (
    <Sonner
      theme={resolveSonnerTheme(forcedTheme ?? theme)}
      // Modal dialogs disable pointer events on the page; toasts, such as a
      // preview error with Retry over the full-screen phone stage, stay usable.
      className="toaster group pointer-events-auto"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      position="top-center"
      richColors
      containerAriaLabel={t("toaster.notifications")}
      {...props}
      toastOptions={{
        closeButtonAriaLabel: t("toaster.closeToast"),
        ...props.toastOptions,
      }}
    />
  );
};

export { Toaster };
