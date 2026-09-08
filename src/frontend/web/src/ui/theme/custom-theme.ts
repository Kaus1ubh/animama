"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_VAR_NAMES, type ThemeVarName, type ThemeVars } from "./tokens";

const STORAGE_KEY = "custom-theme";
const STYLE_ID = "custom-theme-vars";

const isBrowser = () => typeof window !== "undefined";

const toCss = (vars: ThemeVars) => {
  const lines = THEME_VAR_NAMES.map((name) => {
    const value = vars[name];
    if (!value) return null;
    return `  ${name}: ${value};`;
  }).filter(Boolean);

  if (lines.length === 0) return "";

  return `:root.custom {\n${lines.join("\n")}\n}`;
};

export const readStoredCustomTheme = (): ThemeVars | null => {
  if (!isBrowser()) return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ThemeVars;
  } catch {
    return null;
  }
};

export const writeStoredCustomTheme = (vars: ThemeVars) => {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(vars));
};

export const snapshotThemeVars = (): ThemeVars => {
  if (!isBrowser()) return {};
  const styles = window.getComputedStyle(document.documentElement);
  const vars: ThemeVars = {};
  THEME_VAR_NAMES.forEach((name) => {
    const value = styles.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  });
  return vars;
};

export const applyCustomTheme = (vars: ThemeVars) => {
  if (!isBrowser()) return;
  const css = toCss(vars);
  let styleEl = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
};

export const ensureCustomTheme = (): ThemeVars => {
  const stored = readStoredCustomTheme();
  const next = stored ?? snapshotThemeVars();
  if (!stored) writeStoredCustomTheme(next);
  applyCustomTheme(next);
  return next;
};

export const useCustomTheme = () => {
  const [vars, setVars] = useState<ThemeVars>({});
  const [ready, setReady] = useState(false);

  const load = useCallback(() => {
    if (!isBrowser()) return;
    const next = ensureCustomTheme();
    setVars(next);
    setReady(true);
  }, []);

  const updateVar = useCallback((name: ThemeVarName, value: string) => {
    setVars((prev) => {
      if (prev[name] === value) return prev;
      return { ...prev, [name]: value };
    });
  }, []);

  const resetToCurrent = useCallback(() => {
    if (!isBrowser()) return;
    const next = snapshotThemeVars();
    setVars(next);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || Object.keys(vars).length === 0) return;
    writeStoredCustomTheme(vars);
    applyCustomTheme(vars);
  }, [ready, vars]);

  return { vars, load, updateVar, resetToCurrent };
};
