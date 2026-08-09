"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Panel from "@/components/ui/Panel";

interface Factor {
  id: string;
  friendly_name?: string;
  status: string;
}

const MAX_TOTP_FACTORS = 10;

async function finalizeMfaAction(action: "enroll" | "verify" | "unenroll", factorId: string) {
  const response = await fetch("/api/settings/mfa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, factorId }),
  });
  if (!response.ok) {
    const json = await response.json().catch(() => ({}));
    throw new Error(json.error ?? "Failed to update MFA settings");
  }
}

export default function MfaSection() {
  const [supabase] = useState(createClient);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [friendlyName, setFriendlyName] = useState("");
  const [replacementFactorId, setReplacementFactorId] = useState<string | null>(null);
  const [enrolling, setEnrolling] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadFactors = useCallback(async () => {
    const { data, error: listError } = await supabase.auth.mfa.listFactors();
    if (listError) throw listError;
    setFactors((data?.totp ?? []) as Factor[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void supabase.auth.mfa.listFactors().then(({ data }) => {
      if (active) setFactors((data?.totp ?? []) as Factor[]);
    });
    return () => {
      active = false;
    };
  }, [supabase]);

  const active = factors.filter((factor) => factor.status === "verified");

  async function startEnroll() {
    const name = friendlyName.trim();
    if (!name) {
      setError("Give this authenticator a name, such as Primary phone.");
      return;
    }
    if (active.length >= MAX_TOTP_FACTORS) {
      setError("Remove an authenticator before adding another. The limit is ten.");
      return;
    }
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: name,
      });
      if (enrollError) throw enrollError;
      await finalizeMfaAction("enroll", data.id);
      setEnrolling({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enrollment failed");
    } finally {
      setLoading(false);
    }
  }

  async function verifyEnroll() {
    if (!enrolling) return;
    setError(null);
    setLoading(true);
    try {
      const challenge = await supabase.auth.mfa.challenge({ factorId: enrolling.factorId });
      if (challenge.error) throw challenge.error;
      const verify = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) throw verify.error;
      await finalizeMfaAction("verify", enrolling.factorId);
      if (replacementFactorId) {
        await finalizeMfaAction("unenroll", replacementFactorId);
      }
      setEnrolling(null);
      setReplacementFactorId(null);
      setFriendlyName("");
      setCode("");
      setStatus(replacementFactorId ? "Authenticator replaced." : "Authenticator added.");
      await loadFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function cleanupPendingFactor() {
    if (!enrolling) return;
    setLoading(true);
    setError(null);
    try {
      await finalizeMfaAction("unenroll", enrolling.factorId);
      setEnrolling(null);
      setReplacementFactorId(null);
      setFriendlyName("");
      setCode("");
      await loadFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel enrollment");
    } finally {
      setLoading(false);
    }
  }

  async function unenroll(factorId: string) {
    const warning = active.length === 1
      ? "This is your final authenticator. Removing it disables second-factor protection. Continue?"
      : "Remove this authenticator?";
    if (!window.confirm(warning)) return;
    setError(null);
    setStatus(null);
    setLoading(true);
    try {
      await finalizeMfaAction("unenroll", factorId);
      setStatus("Authenticator removed.");
      await loadFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove authenticator");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Panel title="Security" eyebrow="Multi-factor authentication">
      <p className="mb-4 text-sm text-muted">
        Keep a second authenticator on another device or in a password manager for account
        recovery. FundFlow supports up to ten verified authenticators.
      </p>
      {active.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {active.map((factor) => (
            <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
              <span>{factor.friendly_name ?? "Authenticator"}</span>
              <Badge tone="success">Verified</Badge>
              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    setReplacementFactorId(factor.id);
                    setFriendlyName(factor.friendly_name ?? "Replacement authenticator");
                  }}
                  variant="ghost"
                  size="sm"
                  disabled={Boolean(enrolling)}
                >
                  Replace
                </Button>
                <Button onClick={() => unenroll(factor.id)} variant="ghost" size="sm" disabled={Boolean(enrolling)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!enrolling ? (
        <div className="space-y-3">
          {replacementFactorId && (
            <p className="text-sm text-muted">
              Add and verify the replacement before the old authenticator is removed.
            </p>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label="Authenticator name"
              placeholder="Primary phone"
              maxLength={120}
              value={friendlyName}
              onChange={(event) => setFriendlyName(event.target.value)}
              disabled={active.length >= MAX_TOTP_FACTORS}
            />
            <Button
              onClick={startEnroll}
              loading={loading}
              variant="secondary"
              disabled={active.length >= MAX_TOTP_FACTORS}
            >
              {replacementFactorId ? "Add replacement" : active.length > 0 ? "Add authenticator" : "Enable 2FA"}
            </Button>
          </div>
          {replacementFactorId && (
            <Button variant="ghost" size="sm" onClick={() => setReplacementFactorId(null)}>
              Cancel replacement
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Scan this QR in your authenticator app, then enter the 6-digit code.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt="TOTP QR code" className="h-40 w-40" />
          <p className="break-all text-xs text-muted">Secret: {enrolling.secret}</p>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Verification code"
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-32 tracking-widest"
            />
            <Button onClick={verifyEnroll} loading={loading} disabled={code.length !== 6}>
              Verify
            </Button>
            <Button onClick={cleanupPendingFactor} variant="ghost" disabled={loading}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {status && <output className="mt-3 block text-sm text-success">{status}</output>}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </Panel>
  );
}
