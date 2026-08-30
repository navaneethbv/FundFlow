"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveResume,
  loadResume,
  clearResume,
  type PlaidResume,
} from "@/lib/plaid-resume";
import Button from "@/components/ui/Button";
import PlaidLinkLauncher from "@/components/PlaidLinkLauncher";

export default function ConnectBankButton() {
  const router = useRouter();
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [resume, setResume] = useState<PlaidResume | null>(null);
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The token is single-use: once Link has consumed it (success or exit) it
  // must not be handed back to Plaid. Clearing state here is what stops the
  // next "Connect a bank" click from reopening a completed session.
  const discardFlow = useCallback(() => {
    setLinkToken(null);
    setResume(null);
    setReceivedRedirectUri(null);
  }, []);

  // OAuth banks bounce back to the registered redirect_uri with oauth_state_id
  // in the URL. Once the resume is consumed (success, exit, or an expired
  // saved resume) the parameter is stale: leaving it behind makes the next
  // reload re-read the resume lifecycle and can show "Bank connection expired"
  // after a successful connection. Strip it so the URL reflects the finished
  // flow, matching what the server remembers.
  const cleanOAuthUrl = useCallback(() => {
    if (typeof window === "undefined" || !window.location.search.includes("oauth_state_id")) {
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.delete("oauth_state_id");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

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
        setLinkToken(saved.token);
      } else {
        cleanOAuthUrl();
        setError("Bank connection expired. Please start again.");
      }
    })();
    return () => {
      active = false;
    };
  }, [cleanOAuthUrl]);

  const onSuccess = useCallback(
    async (publicToken: string | null) => {
      if (resume?.mode !== "reconnect" && publicToken === null) {
        clearResume();
        discardFlow();
        cleanOAuthUrl();
        setError("Bank connection did not return a public token.");
        return;
      }

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
                body: JSON.stringify({
                  public_token: publicToken,
                  // Bind the exchange to the link token that opened this Link
                  // session so the server can verify ownership.
                  link_token: linkToken,
                }),
              });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "Failed to connect bank");
        }
        clearResume();
        // The token is spent and the resume is consumed: drop both from client
        // state and scrub the OAuth parameter so a reload does not replay the
        // handshake or misreport it as expired.
        discardFlow();
        cleanOAuthUrl();
        router.refresh();
      } catch (err) {
        clearResume();
        discardFlow();
        cleanOAuthUrl();
        setError(err instanceof Error ? err.message : "Error");
      } finally {
        setBusy(false);
      }
    },
    [resume, router, linkToken, discardFlow, cleanOAuthUrl],
  );

  const onExit = useCallback(() => {
    // Link closed without completing (user cancel or a Plaid-side failure).
    // The token it consumed is single-use, so it must not be reused either:
    // clear it and the resume so the next click mints a fresh session.
    clearResume();
    discardFlow();
    cleanOAuthUrl();
  }, [discardFlow, cleanOAuthUrl]);

  // Mint the link token on click instead of on mount. Reusing an already-issued
  // token keeps a second click from spending another Plaid call.
  const startConnect = useCallback(async () => {
    setError(null);
    if (linkToken) return;
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
      clearResume();
      setLinkToken(null);
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setBusy(false);
    }
  }, [linkToken]);

  return (
    <div className="inline-flex flex-col gap-1">
      <PlaidLinkLauncher
        token={linkToken}
        receivedRedirectUri={receivedRedirectUri ?? undefined}
        onSuccess={onSuccess}
        onExit={onExit}
      />
      <Button
        onClick={startConnect}
        disabled={busy || Boolean(linkToken)}
        loading={busy || Boolean(linkToken)}
      >
        {busy || linkToken ? "Opening..." : "Connect a bank"}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
