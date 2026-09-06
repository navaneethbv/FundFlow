import { useEffect } from "react";

// Module-level lock counter to handle nested or overlapping overlays cleanly.
let lockCount = 0;
let originalOverflow = "";

/**
 * Hook to lock body scrolling while an overlay/modal is open.
 * Supports multiple nested or simultaneous locks by tracking a lock count.
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.body.style.overflow = originalOverflow;
      }
    };
  }, [locked]);
}
