"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "@/components/ui/icons";

/**
 * Privacy blur: hides every currency amount on screen (via the
 * [data-privacy="blur"] CSS rule over .metric-value) for trains, screen
 * shares, and shoulder surfers. Purely cosmetic and device-local — the
 * data still reaches the browser; this is a glance shield, not a lock.
 */
const STORAGE_KEY = "fundflow-privacy";
/** Fired by DisplayPrefsApplier when a session starts blurred by default. */
export const PRIVACY_CHANGE_EVENT = "fundflow-privacy-change";

function applyPrivacy(blurred: boolean) {
  document.documentElement.dataset.privacy = blurred ? "blur" : "";
  localStorage.setItem(STORAGE_KEY, blurred ? "blur" : "off");
}

export default function PrivacyToggle() {
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    let active = true;
    const sync = () => {
      if (!active) return;
      const stored = localStorage.getItem(STORAGE_KEY) === "blur";
      document.documentElement.dataset.privacy = stored ? "blur" : "";
      setBlurred(stored);
    };
    Promise.resolve().then(sync);
    window.addEventListener(PRIVACY_CHANGE_EVENT, sync);
    return () => {
      active = false;
      window.removeEventListener(PRIVACY_CHANGE_EVENT, sync);
    };
  }, []);

  const toggle = () => {
    applyPrivacy(!blurred);
    setBlurred(!blurred);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={blurred}
      aria-label={blurred ? "Show amounts" : "Hide amounts"}
      title={blurred ? "Show amounts" : "Hide amounts"}
      className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      {blurred ? (
        <EyeOff aria-hidden className="h-[1.15rem] w-[1.15rem]" />
      ) : (
        <Eye aria-hidden className="h-[1.15rem] w-[1.15rem]" />
      )}
    </button>
  );
}
