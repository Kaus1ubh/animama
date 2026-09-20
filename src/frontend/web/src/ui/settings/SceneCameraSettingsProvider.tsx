"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

type SceneCameraSettingsContextValue = {
  panel: ReactNode;
  setPanel: Dispatch<SetStateAction<ReactNode>>;
};

const SceneCameraSettingsContext =
  createContext<SceneCameraSettingsContextValue | null>(null);

/** Expose the mounted scene's live camera controls to the sibling App Settings modal. */
export function SceneCameraSettingsProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [panel, setPanel] = useState<ReactNode>(null);
  const value = useMemo(() => ({ panel, setPanel }), [panel]);
  return (
    <SceneCameraSettingsContext.Provider value={value}>
      {children}
    </SceneCameraSettingsContext.Provider>
  );
}

/** PiP and isolated scene consumers can render without the application settings shell. */
export function useSceneCameraSettings() {
  return useContext(SceneCameraSettingsContext);
}
