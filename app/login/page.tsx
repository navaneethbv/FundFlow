import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";
import AuthShell from "@/components/shell/AuthShell";

// Nonce-based CSP requires per-request rendering: the nonce in the CSP header
// (set in proxy.ts) must match the nonce Next stamps on its scripts, and Next
// only does that when the page renders dynamically.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthShell title="Welcome back" subtitle="Take control of your money. Make confident financial decisions.">
      {/* LoginForm reads useSearchParams (callback errors), which requires a
          Suspense boundary on this prerendered page. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
