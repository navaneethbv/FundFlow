import { Suspense } from "react";
import LoginForm from "@/components/LoginForm";

// Nonce-based CSP requires per-request rendering: the nonce in the CSP header
// (set in proxy.ts) must match the nonce Next stamps on its scripts, and Next
// only does that when the page renders dynamically. A static prerender ships
// scripts with no nonce, which strict-dynamic then blocks — a dead page.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      {/* LoginForm reads useSearchParams (callback errors), which requires a
          Suspense boundary on this prerendered page. */}
      <Suspense>
        <LoginForm />
      </Suspense>
    </main>
  );
}
