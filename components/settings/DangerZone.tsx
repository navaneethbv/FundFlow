"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";

type StepUpMethod = "totp" | "password" | null;

export default function DangerZone() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>(null);
  const [code, setCode] = useState("");

  // Decide the re-authentication method up front: users with a verified TOTP
  // factor confirm with a fresh code; everyone else re-enters their password.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (active) {
        setStepUpMethod(
          (data?.totp ?? []).some((factor) => factor.status === "verified")
            ? "totp"
            : "password",
        );
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  function beginConfirm() {
    if (
      !confirm(
        "Permanently delete your account and all financial data? This cannot be undone.",
      )
    ) {
      return;
    }
    setError(null);
    setCode("");
    setConfirming(true);
  }

  async function deleteAccount(e: React.SyntheticEvent) {
    e.preventDefault();
    if (!stepUpMethod || code.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: stepUpMethod, code }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Deletion failed");
      }
      await supabase.auth.signOut();
      router.push("/signup");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  return (
    <Panel title="Danger zone" tone="danger">
      <p className="mb-4 text-sm text-muted">
        Deletes your account, removes all bank connections at Plaid, and erases
        all stored data.
      </p>
      {!confirming ? (
        <Button
          onClick={beginConfirm}
          disabled={busy}
          variant="danger"
          loading={busy}
        >
          Delete my account
        </Button>
      ) : (
        <form onSubmit={deleteAccount} className="space-y-3">
          <Field
            label={
              stepUpMethod === "totp"
                ? "Confirm with your authenticator code"
                : "Confirm with your password"
            }
            htmlFor="danger-zone-step-up"
          >
            <Input
              id="danger-zone-step-up"
              type={stepUpMethod === "totp" ? "text" : "password"}
              required
              autoComplete={
                stepUpMethod === "totp" ? "one-time-code" : "current-password"
              }
              inputMode={stepUpMethod === "totp" ? "numeric" : undefined}
              pattern={stepUpMethod === "totp" ? "[0-9]*" : undefined}
              maxLength={stepUpMethod === "totp" ? 6 : undefined}
              placeholder={stepUpMethod === "totp" ? "6-digit code" : "Password"}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="danger"
              loading={busy}
              disabled={code.length === 0}
            >
              {busy ? "Deleting..." : "Confirm deletion"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
