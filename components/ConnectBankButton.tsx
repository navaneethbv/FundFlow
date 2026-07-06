"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import {
  saveResume,
  loadResume,
  clearResume,
  type PlaidResume,
} from "@/lib/plaid-resume";

export default function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [resume, setResume] = useState<PlaidResume | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, either resume an OAuth redirect (possibly a reconnect started on
  // Settings) or fetch a fresh link token for a new connection. Browser globals
  // are read inside the effect, after a microtask, to avoid hydration mismatches
  // and synchronous setState in the effect body.
  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (!active) return;

      if (window.location.search.includes("oauth_state_id")) {
        const saved = loadResume();
        if (!active) return;
        if (saved) {
          setResume(saved);
          setReceivedRedirectUri(window.location.href);
          setLinkToken(saved.token);
        } else {
          setError("Bank connection expired. Please start again.");
        }
        return;
      }

      try {
        const res = await fetch("/api/plaid/link-token", { method: "POST" });
        if (!res.ok) throw new Error("Could not start bank connection");
        const json = await res.json();
        if (!active) return;
        const next: PlaidResume = { token: json.link_token, mode: "connect" };
        saveResume(next);
        setResume(next);
        setLinkToken(json.link_token);
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : "Error");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const onSuccess = useCallback(
    async (publicToken: string) => {
      setBusy(true);
      setError(null);
      try {
        // Route by what started the flow. A reconnect resumes an existing item
        // (the server already holds its access token), so it ignores the public
        // token and finalizes via /reconnect; a new connection exchanges it.
        const res =
          resume?.mode === "reconnect"
            ? await fetch("/api/plaid/reconnect", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ item_id: resume.itemId }),
              })
            : await fetch("/api/plaid/exchange", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ public_token: publicToken }),
              });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to connect bank");
        }
        clearResume();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [resume, router],
  );

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess: (public_token) => onSuccess(public_token),
  });

  // After an OAuth bounce, Link must be re-opened to complete the handshake.
  useEffect(() => {
    if (receivedRedirectUri && ready) open();
  }, [receivedRedirectUri, ready, open]);

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={() => open()}
        disabled={!ready || !linkToken || busy}
        className="rounded bg-foreground text-background px-4 py-2 font-medium disabled:opacity-50"
      >
        {busy ? "Connecting…" : "Connect a bank"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
