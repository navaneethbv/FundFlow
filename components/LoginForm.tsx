"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { needsMfaStepUp } from "@/lib/mfa";
import GoogleSignInButton from "@/components/GoogleSignInButton";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Input from "@/components/ui/Input";
import { ShieldCheck } from "@/components/ui/icons";

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
  const digitRefs = useRef<HTMLInputElement[]>([]);

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

  function handleDigitChange(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = code.padEnd(6, " ").split("");
    next[index] = digit || " ";
    const joined = next.join("").replace(/\s/g, "").slice(0, 6);
    setCode(joined);
    if (digit && index < 5) digitRefs.current[index + 1]?.focus();
  }

  function handleDigitKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !code[index] && index > 0) {
      digitRefs.current[index - 1]?.focus();
    }
  }

  function handleDigitPaste(event: React.ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pasted = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    setCode(pasted);
    digitRefs.current[Math.min(pasted.length, 5)]?.focus();
  }

  return (
    <div className="space-y-6">
      {!mfaRequired ? (
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <Field label="Email">
            <Input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <Button type="submit" loading={loading} size="lg">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      ) : (
        <form onSubmit={handleMfaSubmit} className="space-y-4">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent">
            <ShieldCheck aria-hidden className="h-6 w-6" />
          </div>
          <p className="text-center text-sm text-muted">
            Enter the 6-digit code from your authenticator app.
          </p>
          <div className="flex justify-center gap-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <input
                key={index}
                ref={(element) => {
                  if (element) digitRefs.current[index] = element;
                }}
                aria-label={`Digit ${index + 1}`}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={1}
                required
                value={code[index] ?? ""}
                onChange={(e) => handleDigitChange(index, e.target.value)}
                onKeyDown={(e) => handleDigitKeyDown(index, e)}
                onPaste={handleDigitPaste}
                className="h-11 w-10 rounded-field border border-panel-border bg-panel-2 text-center text-lg font-bold text-foreground focus:border-accent focus:outline-none"
              />
            ))}
          </div>
          <Button type="submit" loading={loading} size="lg" disabled={loading || code.length !== 6}>
            {loading ? "Verifying..." : "Verify"}
          </Button>
        </form>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!mfaRequired && <GoogleSignInButton />}

      <p className="text-sm text-muted">
        No account?{" "}
        <Link href="/signup" className="font-semibold text-accent hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
