"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * "Continue with Google" via Supabase OAuth (PKCE). The redirect lands on
 * /auth/callback, which exchanges the code for a session — same path the
 * email-confirmation flow uses. Requires the Google provider to be enabled
 * in the Supabase dashboard (see README "Google sign-in").
 */
export default function GoogleSignInButton() {
  const supabase = createClient();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setError(null);
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (oauthError) {
      // On success the browser navigates away; we only get here on failure.
      setError(oauthError.message);
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs uppercase tracking-wider opacity-50">
        <span className="h-px flex-1 bg-current" />
        or
        <span className="h-px flex-1 bg-current" />
      </div>
      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={loading}
        className="w-full rounded border border-black/15 dark:border-white/25 py-2 font-medium flex items-center justify-center gap-2 disabled:opacity-50"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
          <path
            fill="#4285F4"
            d="M23.52 12.27c0-.85-.08-1.66-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.58-5.17 3.58-8.8z"
          />
          <path
            fill="#34A853"
            d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.88-3c-1.07.72-2.45 1.15-4.06 1.15-3.13 0-5.78-2.11-6.72-4.95H1.27v3.09A12 12 0 0 0 12 24z"
          />
          <path
            fill="#FBBC05"
            d="M5.28 14.29a7.2 7.2 0 0 1 0-4.58V6.62H1.27a12 12 0 0 0 0 10.76l4.01-3.09z"
          />
          <path
            fill="#EA4335"
            d="M12 4.77c1.76 0 3.35.61 4.6 1.8l3.44-3.44A11.97 11.97 0 0 0 12 0 12 12 0 0 0 1.27 6.62l4.01 3.09C6.22 6.88 8.87 4.77 12 4.77z"
          />
        </svg>
        {loading ? "Redirecting…" : "Continue with Google"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
