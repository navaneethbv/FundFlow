import SignupForm from "@/components/SignupForm";
import AuthShell from "@/components/shell/AuthShell";

// Nonce-based CSP requires per-request rendering (see app/login/page.tsx): a
// static prerender ships scripts with no nonce, which the CSP then blocks.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <AuthShell title="Create your account" subtitle="Start with secure bank sync and privacy-safe exports.">
      <SignupForm />
    </AuthShell>
  );
}
