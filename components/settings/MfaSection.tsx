"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

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

      await supabase
        .from("profiles")
        .update({ mfa_enrolled: true })
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");

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
    await supabase.auth.mfa.unenroll({ factorId });
    await loadFactors();
    const { data } = await supabase.auth.mfa.listFactors();
    if ((data?.totp ?? []).length === 0) {
      await supabase
        .from("profiles")
        .update({ mfa_enrolled: false })
        .eq("id", (await supabase.auth.getUser()).data.user?.id ?? "");
    }
  }

  const active = factors.filter((f) => f.status === "verified");

  return (
    <section className="rounded-lg border border-black/10 dark:border-white/15 p-4 space-y-3">
      <h2 className="font-semibold">Two-factor authentication (TOTP)</h2>

      {active.length > 0 && (
        <ul className="text-sm space-y-1">
          {active.map((f) => (
            <li key={f.id} className="flex justify-between items-center">
              <span>{f.friendly_name ?? "Authenticator"} · enabled</span>
              <button
                onClick={() => unenroll(f.id)}
                className="text-red-600 underline text-xs"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!enrolling ? (
        <button
          onClick={startEnroll}
          disabled={loading}
          className="rounded border border-black/15 dark:border-white/25 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {active.length > 0 ? "Add another authenticator" : "Enable 2FA"}
        </button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm opacity-80">
            Scan this QR in your authenticator app, then enter the 6-digit code.
          </p>
          {/* qr_code is an inline SVG data URI */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={enrolling.qr} alt="TOTP QR code" className="w-40 h-40" />
          <p className="text-xs opacity-60 break-all">
            Secret: {enrolling.secret}
          </p>
          <div className="flex gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="rounded border border-black/15 dark:border-white/25 bg-transparent px-3 py-1.5 text-sm tracking-widest"
            />
            <button
              onClick={verifyEnroll}
              disabled={loading}
              className="rounded bg-foreground text-background px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Verify
            </button>
            <button
              onClick={() => setEnrolling(null)}
              className="text-sm underline opacity-70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}
