"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import {
  saveResume,
  loadResume,
  clearResume,
  type PlaidResume,
} from "@/lib/plaid-resume";
import Button from "@/components/ui/Button";

export default function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [resume, setResume] = useState<PlaidResume | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set once the user has actually asked to connect. A ref, not state: it only
  // needs to survive the link-token round trip so the effect below can open Link
  // the moment it is ready, and flipping it must not itself cause a render.
  const wantsOpenRef = useRef(false);

  // Only an OAuth bounce needs work on mount. A plain page view must never
  // touch Plaid: minting a link token here spends a Plaid API call and boots
  // Link's iframe (workflow/start + heartbeat) on every dashboard and accounts
  // render, for every visitor who never clicks Connect. Browser globals are
  // read inside the effect, after a microtask, to avoid hydration mismatches
  // and synchronous setState in the effect body.
  useEffect(() => {
    let active = true;
    (async () => {
      await Promise.resolve();
      if (!active) return;
      if (!window.location.search.includes("oauth_state_id")) return;

      const saved = loadResume();
      if (!active) return;
      if (saved) {
        setResume(saved);
        setReceivedRedirectUri(window.location.href);
        wantsOpenRef.current = true;
        setLinkToken(saved.token);
      } else {
        setError("Bank connection expired. Please start again.");
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

  // Mint the link token on click instead of on mount. Reusing an already-issued
  // token keeps a second click from spending another Plaid call.
  const startConnect = useCallback(async () => {
    setError(null);
    if (linkToken) {
      // Already issued: open now if Link is ready, otherwise let the effect
      // pick it up. Either way, no second Plaid call.
      if (ready) open();
      else wantsOpenRef.current = true;
      return;
    }

    wantsOpenRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/plaid/link-token", { method: "POST" });
      if (!res.ok) throw new Error("Could not start bank connection");
      const json = await res.json();
      const next: PlaidResume = { token: json.link_token, mode: "connect" };
      saveResume(next);
      setResume(next);
      setLinkToken(json.link_token);
    } catch (err) {
      wantsOpenRef.current = false;
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [linkToken, ready, open]);

  // Open Link as soon as it is ready, but only because the user clicked or an
  // OAuth bounce is resuming the handshake. Clearing the intent first stops a
  // later re-render from reopening Link behind the user's back.
  useEffect(() => {
    if (!wantsOpenRef.current || !ready || !linkToken) return;
    wantsOpenRef.current = false;
    open();
  }, [ready, linkToken, open]);

  return (
    <div className="inline-flex flex-col gap-1">
      <Button onClick={startConnect} disabled={busy} loading={busy}>
        {busy ? "Connecting..." : "Connect a bank"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
