"use client";

import { useEffect, useRef } from "react";

// F5, F6, F10, F11 and F12 are left alone: browsers reserve them for reload,
// the address bar, the menu bar, full screen and developer tools.
export type FunctionKey = "F1" | "F2" | "F3" | "F4" | "F7" | "F8" | "F9";

// Binds F-keys to the options of whatever modal is open. Listens in the
// capture phase and calls preventDefault, so page-level shortcuts (which skip
// handled events) never fire for the same key press.
export function useFunctionKeys(bindings: Partial<Record<FunctionKey, () => void>>, enabled = true) {
  const bindingsRef = useRef(bindings);

  useEffect(() => {
    bindingsRef.current = bindings;
  });

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const action = bindingsRef.current[event.key as FunctionKey];
      if (!action) return;
      event.preventDefault();
      if (!event.repeat) action();
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
