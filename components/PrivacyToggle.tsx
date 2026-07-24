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

function applyPrivacy(blurred: boolean) {
  document.documentElement.dataset.privacy = blurred ? "blur" : "";
  localStorage.setItem(STORAGE_KEY, blurred ? "blur" : "off");
}

export default function PrivacyToggle() {
  const [blurred, setBlurred] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      const stored = localStorage.getItem(STORAGE_KEY) === "blur";
      document.documentElement.dataset.privacy = stored ? "blur" : "";
      setBlurred(stored);
    });
    return () => {
      active = false;
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
      className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-panel-border bg-panel-2 text-muted shadow-sm transition-colors duration-150 hover:border-accent/50 hover:text-foreground focus-visible:outline-2"
    >
      {blurred ? (
        <EyeOff aria-hidden className="h-3.5 w-3.5" />
      ) : (
        <Eye aria-hidden className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
