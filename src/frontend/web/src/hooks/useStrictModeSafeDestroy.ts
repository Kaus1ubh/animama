"use client";

import { useEffect, useRef } from "react";

/**
 * Destroys stateful third-party instances on real unmount while preserving them
 * through React StrictMode's dev-only mount cleanup/setup replay.
 *
 * We need this for objects such as Uppy instances: destroying during the
 * StrictMode replay removes plugins from the still-mounted instance, leaving UI
 * controls alive but unable to perform their side effects.
 */
export function useStrictModeSafeDestroy<TInstance>(
  instance: TInstance,
  destroy: (instance: TInstance) => void,
) {
  const destroyRef = useRef(destroy);
  const destroyTimerRef = useRef<{
    timer: number;
    instance: TInstance;
  } | null>(null);

  destroyRef.current = destroy;

  useEffect(() => {
    const pendingDestroy = destroyTimerRef.current;
    if (pendingDestroy?.instance === instance) {
      window.clearTimeout(pendingDestroy.timer);
      destroyTimerRef.current = null;
    }

    return () => {
      const timer = window.setTimeout(() => {
        destroyRef.current(instance);
        if (destroyTimerRef.current?.timer === timer) {
          destroyTimerRef.current = null;
        }
      }, 0);
      destroyTimerRef.current = { timer, instance };
    };
  }, [instance]);
}
