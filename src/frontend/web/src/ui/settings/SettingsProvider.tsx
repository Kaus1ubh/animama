"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { createThemeEchoTracker } from "@/lib/theme/theme-echo-tracker";
import {
  applyAppearanceOverrideCss,
  buildAppearanceOverrideCss,
  parseAppearanceOverrides,
} from "@/lib/theme/appearance-overrides";

import type {
  PyAnimaDispatchOptions,
  PyAnimaSettings,
  PyAnimaSettingsUpdate,
  PyUserSettings,
  PyUserSettingsUpdate,
} from "@/lib/content/catalogTypes";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import {
  mergePreferences,
  normalizeThemeSetting,
  resolvePreferences,
  themesEquivalent,
  type SettingsPreferences,
} from "@/lib/settings/preferences";
import { createLogger } from "@/lib/logger";
import { useAnimaSettings } from "@/query/hooks/useAnimaSettings";
import { useUserSettings } from "@/query/hooks/useUserSettings";
import { useUpdateAnimaSettings } from "@/query/mutations/useUpdateAnimaSettings";
import { useUpdateUserSettings } from "@/query/mutations/useUpdateUserSettings";

export type SettingsContextValue = {
  animaId: string | null;
  userSettings: PyUserSettings | null;
  animaSettings: PyAnimaSettings | null;
  userPreferences: SettingsPreferences | null;
  animaPreferences: SettingsPreferences | null;
  effectivePreferences: SettingsPreferences;
  isLoading: boolean;
  isUpdating: boolean;
  updateUserSettings: (
    patch: PyUserSettingsUpdate,
  ) => Promise<PyUserSettings | undefined>;
  updateAnimaSettings: (
    patch: PyAnimaSettingsUpdate,
  ) => Promise<PyAnimaSettings | undefined>;
  updateUserPreferences: (
    patch: SettingsPreferences,
  ) => Promise<PyUserSettings | undefined>;
  updateAnimaPreferences: (
    patch: SettingsPreferences,
  ) => Promise<PyAnimaSettings | undefined>;
  chatRequestOptions: PyAnimaDispatchOptions | null;
  setChatRequestOverrides: Dispatch<
    SetStateAction<Partial<PyAnimaDispatchOptions>>
  >;
  chatMarkdownEnabled: boolean;
  /** Saves `presentation.render_markdown` in app preferences. */
  setChatMarkdownEnabled: (enabled: boolean) => void;
};

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function useSettings(): SettingsContextValue {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error("useSettings must be used within SettingsProvider");
  }
  return context;
}

export function SettingsProvider({
  children,
  animaId,
}: {
  children: ReactNode;
  animaId?: string | null;
}) {
  const resolvedAnimaId = animaId ?? null;
  const userId = useRuntimeOwnerId();
  const { theme, setTheme } = useTheme();
  const logger = useMemo(() => createLogger("Settings"), []);

  const userSettingsQuery = useUserSettings({ enabled: Boolean(userId) });
  const animaSettingsQuery = useAnimaSettings(resolvedAnimaId, {
    enabled: Boolean(userId && resolvedAnimaId),
  });
  const updateUserSettingsMutation = useUpdateUserSettings();
  const updateAnimaSettingsMutation = useUpdateAnimaSettings();

  const userSettings = userSettingsQuery.data ?? null;
  const animaSettings = animaSettingsQuery.data ?? null;
  const userPreferences =
    (userSettings?.preferences as SettingsPreferences | undefined) ?? null;
  const animaPreferences =
    (animaSettings?.preferences as SettingsPreferences | undefined) ?? null;

  const effectivePreferences = useMemo(
    () => resolvePreferences(userPreferences, animaPreferences),
    [userPreferences, animaPreferences],
  );

  const updateUserSettings = useCallback(
    async (patch: PyUserSettingsUpdate) => {
      if (!userId) return undefined;
      logger.info("UserSettings", "Updating user settings", {
        userId,
        patch,
      });
      try {
        const result = await updateUserSettingsMutation.mutateAsync({
          body: patch,
        });
        logger.info("UserSettings", "Updated user settings", {
          userId,
          patch,
        });
        return result;
      } catch (error) {
        logger.error("UserSettings", "User settings update failed", error);
        throw error;
      }
    },
    [logger, updateUserSettingsMutation, userId],
  );

  const updateAnimaSettings = useCallback(
    async (patch: PyAnimaSettingsUpdate) => {
      if (!userId || !resolvedAnimaId) return undefined;
      logger.info("AnimaSettings", "Updating anima settings", {
        userId,
        animaId: resolvedAnimaId,
        patch,
      });
      try {
        const result = await updateAnimaSettingsMutation.mutateAsync({
          animaId: resolvedAnimaId,
          body: patch,
        });
        logger.info("AnimaSettings", "Updated anima settings", {
          userId,
          animaId: resolvedAnimaId,
          patch,
        });
        return result;
      } catch (error) {
        logger.error("AnimaSettings", "Anima settings update failed", error);
        throw error;
      }
    },
    [logger, resolvedAnimaId, updateAnimaSettingsMutation, userId],
  );

  const updateUserPreferences = useCallback(
    async (patch: SettingsPreferences) => {
      const base = userPreferences ?? {};
      const merged = mergePreferences(base, patch);
      logger.info("Preferences", "Updating user preferences", {
        userId,
        patch,
      });
      return updateUserSettings({ preferences: merged });
    },
    [logger, updateUserSettings, userId, userPreferences],
  );

  const updateAnimaPreferences = useCallback(
    async (patch: SettingsPreferences) => {
      // Base on stored Anima values only; copying app defaults into the Anima
      // row would turn inherited settings into explicit overrides.
      const base = animaPreferences ?? {};
      const merged = mergePreferences(base, patch);
      logger.info("Preferences", "Updating anima preferences", {
        userId,
        animaId: resolvedAnimaId,
        patch,
      });
      return updateAnimaSettings({ preferences: merged });
    },
    [logger, animaPreferences, resolvedAnimaId, updateAnimaSettings, userId],
  );

  const [chatRequestOverrides, setChatRequestOverrides] = useState<
    Partial<PyAnimaDispatchOptions>
  >({});
  // Persisted app preference; rendering Markdown stays on unless turned off.
  const chatMarkdownEnabled =
    userPreferences?.presentation?.render_markdown !== false;
  const setChatMarkdownEnabled = useCallback(
    (enabled: boolean) => {
      void updateUserPreferences({
        presentation: { render_markdown: enabled },
      }).catch((error) => {
        logger.error("Preferences", "Markdown preference update failed", error);
        toast.error("Failed to update Markdown rendering.");
      });
    },
    [logger, updateUserPreferences],
  );

  const chatRequestOptions = useMemo(() => {
    const entries: Array<[string, boolean | string | string[]]> = [];
    for (const [key, value] of Object.entries(chatRequestOverrides)) {
      if (typeof value === "boolean") {
        entries.push([key, value]);
        continue;
      }
      if (typeof value === "string" && value.trim()) {
        entries.push([key, value.trim()]);
        continue;
      }
      if (Array.isArray(value)) {
        const normalized = Array.from(
          new Set(
            value
              .map((item) => String(item).trim())
              .filter((item) => item.length > 0),
          ),
        );
        entries.push([key, normalized]);
      }
    }
    if (entries.length === 0) return null;
    return Object.fromEntries(entries) as PyAnimaDispatchOptions;
  }, [chatRequestOverrides]);

  const pendingTheme = useRef<string | null>(null);
  const appliedSettingsTheme = useRef<string | null>(null);
  // Stored themes that merely echo this client's own saves must not revert a
  // newer local selection (e.g. Dark then Light before the Dark save returns).
  const themeEchoes = useRef(createThemeEchoTracker());

  useEffect(() => {
    const storedTheme = userSettings?.theme ?? null;
    if (appliedSettingsTheme.current === storedTheme) return;
    appliedSettingsTheme.current = storedTheme;

    const preferredTheme = normalizeThemeSetting(storedTheme);
    if (!preferredTheme || !setTheme) return;
    if (themeEchoes.current.consumeEcho(preferredTheme)) return;
    if (preferredTheme === theme) {
      pendingTheme.current = null;
      return;
    }
    logger.info("Theme", "Applying theme from settings", {
      stored: storedTheme,
      normalized: preferredTheme,
      current: theme,
    });
    pendingTheme.current = preferredTheme;
    setTheme(preferredTheme);
  }, [logger, setTheme, theme, userSettings?.theme]);

  useEffect(() => {
    if (!userSettings || !theme) return;
    const normalizedTheme = normalizeThemeSetting(theme);
    if (!normalizedTheme) return;
    if (pendingTheme.current) {
      if (pendingTheme.current === normalizedTheme) {
        pendingTheme.current = null;
        return;
      }
      return;
    }
    if (themesEquivalent(userSettings.theme, normalizedTheme)) return;
    logger.info("Theme", "Persisting theme to settings", {
      stored: userSettings.theme,
      current: theme,
      normalized: normalizedTheme,
    });
    themeEchoes.current.submit(normalizedTheme);
    void updateUserSettings({ theme: normalizedTheme }).catch((error) => {
      themeEchoes.current.fail(normalizedTheme);
      logger.error("Theme", "Theme persistence failed", error);
    });
  }, [logger, theme, updateUserSettings, userSettings]);

  // Apply per-mode colour overrides from app preferences on top of the theme.
  const appearanceCss = useMemo(
    () =>
      buildAppearanceOverrideCss(
        parseAppearanceOverrides(userPreferences?.appearance),
      ),
    [userPreferences?.appearance],
  );
  useEffect(() => {
    applyAppearanceOverrideCss(appearanceCss);
  }, [appearanceCss]);

  const value = useMemo<SettingsContextValue>(
    () => ({
      animaId: resolvedAnimaId,
      userSettings,
      animaSettings,
      userPreferences,
      animaPreferences,
      effectivePreferences,
      isLoading: userSettingsQuery.isLoading || animaSettingsQuery.isLoading,
      isUpdating:
        updateUserSettingsMutation.isPending ||
        updateAnimaSettingsMutation.isPending,
      updateUserSettings,
      updateAnimaSettings,
      updateUserPreferences,
      updateAnimaPreferences,
      chatRequestOptions,
      setChatRequestOverrides,
      chatMarkdownEnabled,
      setChatMarkdownEnabled,
    }),
    [
      chatRequestOptions,
      chatMarkdownEnabled,
      setChatMarkdownEnabled,
      effectivePreferences,
      animaPreferences,
      animaSettings,
      animaSettingsQuery.isLoading,
      resolvedAnimaId,
      updateAnimaPreferences,
      updateAnimaSettings,
      updateAnimaSettingsMutation.isPending,
      updateUserPreferences,
      updateUserSettings,
      updateUserSettingsMutation.isPending,
      userPreferences,
      userSettings,
      userSettingsQuery.isLoading,
      setChatRequestOverrides,
    ],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}
