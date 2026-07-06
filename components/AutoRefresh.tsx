"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const LAST_AUTO_SYNC_KEY = "fundflow.lastAutoSyncAt";

/**
 * Keeps the open page live, in two rate-conscious layers:
 *
 * 1. UI re-render (`router.refresh()`) every `uiRefreshSeconds` while the tab
 *    is visible — re-runs the server queries only, NO Plaid calls, so new
 *    transactions written by the webhook or cron appear as they happen.
 * 2. A background Plaid pull ({ source: "auto" }) at most every
 *    `syncIntervalSeconds`. localStorage coordinates tabs as a courtesy; the
 *    route enforces the same window server-side, so extra calls collapse to
 *    200 { skipped: true } and never burn Plaid rate limit. If the pull is
 *    rate-limited or fails, we back off for a full window and rely on layer 1
 *    — the user's manual Refresh button always remains available.
 *
 * Renders nothing.
 */
export default function AutoRefresh({
  uiRefreshSeconds = 120,
  syncIntervalSeconds = 1800,
}: {
  uiRefreshSeconds?: number;
  syncIntervalSeconds?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function maybeAutoSync() {
      if (document.visibilityState !== "visible") return;
      const last = Number(window.localStorage.getItem(LAST_AUTO_SYNC_KEY)) || 0;
      if (Date.now() - last < syncIntervalSeconds * 1000) return;
      // Claim the window before the call so parallel tabs don't double-fire.
      window.localStorage.setItem(LAST_AUTO_SYNC_KEY, String(Date.now()));
      try {
        const res = await fetch("/api/plaid/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ source: "auto" }),
        });
        if (res.ok && !cancelled) {
          const json = await res.json().catch(() => ({}));
          if (!json.skipped) router.refresh();
        }
        // Non-OK (e.g. 429): timestamp already set — back off a full window.
      } catch {
        // Network hiccup: back off; the UI-refresh layer keeps running.
      }
    }

    function uiRefresh() {
      if (document.visibilityState === "visible") router.refresh();
    }

    function onVisible() {
      if (document.visibilityState === "visible") {
        router.refresh(); // catch up immediately when the tab returns
        void maybeAutoSync();
      }
    }

    void maybeAutoSync();
    const syncTimer = window.setInterval(() => void maybeAutoSync(), 60_000);
    const uiTimer = window.setInterval(uiRefresh, uiRefreshSeconds * 1000);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(syncTimer);
      window.clearInterval(uiTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, uiRefreshSeconds, syncIntervalSeconds]);

  return null;
}
