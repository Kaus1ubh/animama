"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { Avatar } from "@/lib/avatar";

type SceneRuntimeContextValue = {
  avatar: Avatar | null;
};

const DEFAULT_SCENE_RUNTIME_CONTEXT: SceneRuntimeContextValue = {
  avatar: null,
};

const SceneRuntimeContext = createContext<SceneRuntimeContextValue>(
  DEFAULT_SCENE_RUNTIME_CONTEXT,
);

export function SceneRuntimeProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SceneRuntimeContextValue;
}) {
  return (
    <SceneRuntimeContext.Provider value={value}>
      {children}
    </SceneRuntimeContext.Provider>
  );
}

export function useSceneRuntime() {
  return useContext(SceneRuntimeContext);
}
