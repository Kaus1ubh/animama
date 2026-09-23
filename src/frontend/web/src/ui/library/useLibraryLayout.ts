import { useState } from "react";

import { createLogger } from "@/lib/logger";
import type { LibraryLayout } from "./LibraryProductRow";

const STORAGE_KEY = "animama.library.layout";
const logger = createLogger("LibraryLayout");

function loadLayout(): LibraryLayout {
  if (typeof window === "undefined") return "grid";
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "list"
      ? "list"
      : "grid";
  } catch (error) {
    logger.warn("Storage", "Could not load Library layout", { error });
    return "grid";
  }
}

/** Keep the display preference across Library visits without changing filters. */
export function useLibraryLayout() {
  const [layout, setLayout] = useState<LibraryLayout>(loadLayout);
  const changeLayout = (next: LibraryLayout) => {
    setLayout(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch (error) {
      logger.warn("Storage", "Could not save Library layout", { error });
    }
  };
  return [layout, changeLayout] as const;
}
