"use client";

import { useEffect, useState, useCallback } from "react";
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

export default function MfaSection() {
  const supabase = createClient();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrolling, setEnrolling] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function finalizeMfaAction(action: "enroll" | "unenroll", factorId: string) {
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

  const loadFactors = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.mfa.listFactors();
      if (active) setFactors((data?.totp ?? []) as Factor[]);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function startEnroll() {
    setError(null);
    setLoading(true);
    try {
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${Date.now()}`,
      });
      if (enrollError) throw enrollError;
      setEnrolling({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
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
      const challenge = await supabase.auth.mfa.challenge({
        factorId: enrolling.factorId,
      });
      if (challenge.error) throw challenge.error;
      const verify = await supabase.auth.mfa.verify({
        factorId: enrolling.factorId,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) throw verify.error;

      await finalizeMfaAction("enroll", enrolling.factorId);

      setEnrolling(null);
      setCode("");
      await loadFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  async function unenroll(factorId: string) {
    setError(null);
    setLoading(true);
    try {
      await finalizeMfaAction("unenroll", factorId);
      await loadFactors();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove authenticator");
    } finally {
      setLoading(false);
    }
  }

  const active = factors.filter((f) => f.status === "verified");

  return (
    <Panel title="Security" eyebrow="Multi-factor authentication">

      {active.length > 0 && (
        <ul className="mb-4 space-y-2 text-sm">
          {active.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-3 rounded-field bg-panel-2 p-3">
              <span>{f.friendly_name ?? "Authenticator"}</span>
              <Badge tone="success">Enabled</Badge>
              <Button
                onClick={() => unenroll(f.id)}
                variant="ghost"
                size="sm"
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      {!enrolling ? (
        <Button
          onClick={startEnroll}
          loading={loading}
          variant="secondary"
        >
          {active.length > 0 ? "Add another authenticator" : "Enable 2FA"}
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            Scan this QR in your authenticator app, then enter the 6-digit code.
          </p>
          {/* qr_code is an inline SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt="TOTP QR code" className="w-40 h-40" />
          <p className="break-all text-xs text-muted">
            Secret: {enrolling.secret}
          </p>
          <div className="flex gap-2">
            <Input
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-32 tracking-widest"
            />
            <Button
              onClick={verifyEnroll}
              loading={loading}
            >
              Verify
            </Button>
            <Button
              onClick={() => setEnrolling(null)}
              variant="ghost"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </Panel>
  );
}
