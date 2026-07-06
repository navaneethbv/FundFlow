import SignupForm from "@/components/SignupForm";

// Nonce-based CSP requires per-request rendering (see app/login/page.tsx): a
// static prerender ships scripts with no nonce, which the CSP then blocks.
export const dynamic = "force-dynamic";

export default function SignupPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <SignupForm />
    </main>
  );
}
