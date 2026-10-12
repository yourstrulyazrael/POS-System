"use client";

import { useEffect, useRef } from "react";

// Hardware barcode scanners act as keyboards: they "type" the code in a fast
// burst and finish with Enter. Keystrokes arriving within MAX_KEY_GAP_MS of
// each other are buffered; Enter after at least MIN_LENGTH of them is a scan.
const MAX_KEY_GAP_MS = 50;
const MIN_LENGTH = 4;

export function useBarcodeScanner(onScan: (barcode: string) => void, enabled: boolean) {
  const onScanRef = useRef(onScan);
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    if (!enabled) return;
    function handleKeyDown(event: KeyboardEvent) {
      // Text fields handle their own input (the POS search box looks up
      // barcodes on Enter), so only listen when focus is elsewhere.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.ctrlKey || event.altKey || event.metaKey) return;

      const now = performance.now();
      if (now - lastKeyAtRef.current > MAX_KEY_GAP_MS) bufferRef.current = "";
      lastKeyAtRef.current = now;

      if (event.key === "Enter") {
        const code = bufferRef.current;
        bufferRef.current = "";
        if (code.length >= MIN_LENGTH) {
          // Stop the Enter from also clicking whatever button has focus.
          event.preventDefault();
          event.stopPropagation();
          onScanRef.current(code);
        }
        return;
      }
      if (event.key.length === 1) bufferRef.current += event.key;
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [enabled]);
}
