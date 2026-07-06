import Link from "next/link";
import { connection } from "next/server";

export default async function NotFound() {
  // Nonce-based CSP requires request-time rendering so Next can stamp scripts.
  await connection();

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4">
        <p className="text-sm uppercase tracking-wider opacity-60">404</p>
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-sm opacity-80">
          The page you requested does not exist.
        </p>
        <Link href="/dashboard" className="inline-block underline text-sm">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
