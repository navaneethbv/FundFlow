"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import Button from "@/components/ui/Button";
import Panel from "@/components/ui/Panel";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";

type StepUpMethod = "totp" | "password" | null;

async function deleteAccountRequest(
  method: Exclude<StepUpMethod, null>,
  code: string,
  supabase: ReturnType<typeof createClient>,
  router: ReturnType<typeof useRouter>,
): Promise<void> {
  const res = await fetch("/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, code }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Deletion failed");
  }
  await supabase.auth.signOut();
  router.push("/signup");
  router.refresh();
}

/** Everything about the confirm field that differs between the two methods. */
interface StepUpFieldConfig {
  label: string;
  type: "text" | "password";
  autoComplete: string;
  inputMode?: "numeric";
  pattern?: string;
  maxLength?: number;
  placeholder: string;
}

const TOTP_FIELD: StepUpFieldConfig = {
  label: "Confirm with your authenticator code",
  type: "text",
  autoComplete: "one-time-code",
  inputMode: "numeric",
  pattern: "[0-9]*",
  maxLength: 6,
  placeholder: "6-digit code",
};

const PASSWORD_FIELD: StepUpFieldConfig = {
  label: "Confirm with your password",
  type: "password",
  autoComplete: "current-password",
  placeholder: "Password",
};

/**
 * Users with a verified TOTP factor confirm with a fresh code; everyone else
 * re-enters their password.
 */
async function resolveStepUpMethod(
  supabase: ReturnType<typeof createClient>,
): Promise<Exclude<StepUpMethod, null>> {
  const { data } = await supabase.auth.mfa.listFactors();
  return (data?.totp ?? []).some((factor) => factor.status === "verified")
    ? "totp"
    : "password";
}

export default function DangerZone() {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [stepUpMethod, setStepUpMethod] = useState<StepUpMethod>(null);
  const [code, setCode] = useState("");

  // Decide the re-authentication method up front so the confirm field is
  // already the right one when the user opens it.
  useEffect(() => {
    let active = true;
    void resolveStepUpMethod(supabase).then((method) => {
      if (active) setStepUpMethod(method);
    });
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
      await deleteAccountRequest(stepUpMethod, code, supabase, router);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
      setBusy(false);
    }
  }

  const stepUpField = stepUpMethod === "totp" ? TOTP_FIELD : PASSWORD_FIELD;

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
          <Field label={stepUpField.label} htmlFor="danger-zone-step-up">
            <Input
              id="danger-zone-step-up"
              type={stepUpField.type}
              required
              autoComplete={stepUpField.autoComplete}
              inputMode={stepUpField.inputMode}
              pattern={stepUpField.pattern}
              maxLength={stepUpField.maxLength}
              placeholder={stepUpField.placeholder}
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
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
