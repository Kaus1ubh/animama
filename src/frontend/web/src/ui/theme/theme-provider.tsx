import { ThemeProvider as NextThemesProvider } from "next-themes";
import { type ThemeProviderProps } from "next-themes";
import { featureFlags } from "@/lib/feature-flags";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      {...props}
      forcedTheme={featureFlags.themeSelection ? props.forcedTheme : "light"}
      enableSystem={featureFlags.themeSelection ? props.enableSystem : false}
    >
      {children}
    </NextThemesProvider>
  );
}
