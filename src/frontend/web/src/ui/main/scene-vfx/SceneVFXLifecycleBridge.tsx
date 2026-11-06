import { useEffect, useMemo } from "react";

import { useSceneVFXStore } from "@/stores/scene-vfx-store";

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName;
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  return Boolean(
    target.closest(
      '[contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  );
}

function consumeDismissEvent(event: Event) {
  event.preventDefault();
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === "function") {
    event.stopImmediatePropagation();
  }
}

function shouldDismissOnKeydown(event: KeyboardEvent): boolean {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.metaKey ||
    event.ctrlKey ||
    event.altKey ||
    event.shiftKey ||
    isEditableKeyboardTarget(event.target)
  ) {
    return false;
  }

  return (
    event.key === "Escape" ||
    event.key === "Enter" ||
    event.key === " " ||
    event.key === "Spacebar"
  );
}

function shouldDismissOnPointerDown(event: PointerEvent): boolean {
  return !event.defaultPrevented && event.button === 0;
}

export function SceneVFXLifecycleBridge() {
  const activeByKind = useSceneVFXStore((state) => state.activeByKind);
  const activeRuntimeEntries = useMemo(
    () =>
      Object.values(activeByKind).filter(
        (runtimeEntry) => runtimeEntry !== undefined,
      ),
    [activeByKind],
  );
  const clearSceneVFXKind = useSceneVFXStore(
    (state) => state.clearSceneVFXKind,
  );

  useEffect(() => {
    const timers = activeRuntimeEntries
      .filter((runtimeEntry) => runtimeEntry.expiresAtMs !== null)
      .map((runtimeEntry) => {
        const timeoutMs = Math.max(0, runtimeEntry.expiresAtMs! - Date.now());
        return window.setTimeout(() => {
          clearSceneVFXKind(runtimeEntry.kind);
        }, timeoutMs);
      });

    return () => {
      timers.forEach((timerId) => {
        window.clearTimeout(timerId);
      });
    };
  }, [activeRuntimeEntries, clearSceneVFXKind]);

  const dismissibleEntries = useMemo(
    () =>
      activeRuntimeEntries.filter(
        (runtimeEntry) => runtimeEntry.entry.dismissOnInput,
      ),
    [activeRuntimeEntries],
  );

  useEffect(() => {
    if (dismissibleEntries.length === 0) {
      return;
    }

    const shouldConsumeDismissInput = dismissibleEntries.some(
      (runtimeEntry) => runtimeEntry.entry.coverUiOverlays,
    );
    const keydownOptions: AddEventListenerOptions = {
      capture: true,
    };
    const pointerdownOptions: AddEventListenerOptions = {
      capture: true,
      passive: false,
    };
    const handleDismissKeydown = (event: KeyboardEvent) => {
      if (!shouldDismissOnKeydown(event)) {
        return;
      }

      dismissibleEntries.forEach((runtimeEntry) => {
        clearSceneVFXKind(runtimeEntry.kind);
      });

      if (shouldConsumeDismissInput) {
        consumeDismissEvent(event);
      }
    };
    const handleDismissPointerDown = (event: PointerEvent) => {
      if (!shouldDismissOnPointerDown(event)) {
        return;
      }

      dismissibleEntries.forEach((runtimeEntry) => {
        clearSceneVFXKind(runtimeEntry.kind);
      });

      if (shouldConsumeDismissInput) {
        consumeDismissEvent(event);
      }
    };

    document.addEventListener("keydown", handleDismissKeydown, keydownOptions);
    document.addEventListener(
      "pointerdown",
      handleDismissPointerDown,
      pointerdownOptions,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleDismissKeydown,
        keydownOptions,
      );
      document.removeEventListener(
        "pointerdown",
        handleDismissPointerDown,
        pointerdownOptions,
      );
    };
  }, [clearSceneVFXKind, dismissibleEntries]);

  return null;
}
