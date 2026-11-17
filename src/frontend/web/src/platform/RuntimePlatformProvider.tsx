import { createContext, useContext, useState } from "react";
import type { ReactNode } from "react";

import {
  getRuntimePlatformSnapshot,
  type RuntimePlatform,
} from "@/platform/runtime-platform";

type RuntimePlatformProviderProps = {
  children: ReactNode;
};

const RuntimePlatformContext = createContext<RuntimePlatform | null>(null);

export function RuntimePlatformProvider({
  children,
}: RuntimePlatformProviderProps) {
  const [platform] = useState(getRuntimePlatformSnapshot);

  return (
    <RuntimePlatformContext.Provider value={platform}>
      {children}
    </RuntimePlatformContext.Provider>
  );
}

export function useRuntimePlatform(): RuntimePlatform {
  return useContext(RuntimePlatformContext) ?? getRuntimePlatformSnapshot();
}
