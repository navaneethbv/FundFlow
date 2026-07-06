"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { needsMfaStepUp } from "@/lib/mfa";
import GoogleSignInButton from "@/components/GoogleSignInButton";

// Errors forwarded by /auth/callback (e.g. an expired email-confirmation link).
const CALLBACK_ERRORS: Record<string, string> = {
  confirmation_failed:
    "That confirmation link is invalid or expired. Try signing in, or sign up again to get a new link.",
  missing_code:
    "The confirmation link was incomplete. Please use the link from your email.",
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(
    CALLBACK_ERRORS[searchParams.get("error") ?? ""] ?? null,
  );
  const [loading, setLoading] = useState(false);

  // A user who abandoned the TOTP step (or was redirected here by the proxy
  // with an aal1 session) should resume at the code prompt, not the password
  // form. Same async-check-then-set pattern as MfaSection's factor load.
  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (active && data && needsMfaStepUp(data.currentLevel, data.nextLevel)) {
        setMfaRequired(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  async function completeIfMfaRequired(): Promise<boolean> {
    // Returns true if login is fully complete, false if a TOTP code is needed.
    const { data, error: aalError } =
      await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalError) throw aalError;
    if (data.nextLevel === "aal2" && data.nextLevel !== data.currentLevel) {
      setMfaRequired(true);
      return false;
    }
    return true;
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const done = await completeIfMfaRequired();
      if (done) {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totp = factors?.totp?.[0];
      if (!totp) throw new Error("No TOTP factor found");

      const challenge = await supabase.auth.mfa.challenge({ factorId: totp.id });
      if (challenge.error) throw challenge.error;

      const verify = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.data.id,
        code,
      });
      if (verify.error) throw verify.error;

      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold">Sign in to FundFlow</h1>

      {!mfaRequired ? (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-2"
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-2"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-foreground text-background py-2 font-medium disabled:opacity-50"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleMfaSubmit} className="space-y-4">
          <p className="text-sm opacity-80">
            Enter the 6-digit code from your authenticator app.
          </p>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            required
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full rounded border border-black/15 dark:border-white/20 bg-transparent px-3 py-2 tracking-widest"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded bg-foreground text-background py-2 font-medium disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!mfaRequired && <GoogleSignInButton />}

      <p className="text-sm opacity-80">
        No account?{" "}
        <Link href="/signup" className="underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
