"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error("Root error boundary caught", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="eyebrow">FundFlow</p>
      <h1 className="display mt-2 text-3xl">This view is temporarily unavailable</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Something went wrong while loading this page.
        Your data was not changed. Try loading it again.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 min-h-11 rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
      >
        Try again
      </button>
    </main>
  );
}
