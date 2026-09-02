"use client";

import { useEffect } from "react";

export default function BudgetError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error("Budget error boundary caught", error.digest ?? error.message);
  }, [error]);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="eyebrow">Budget</p>
      <h1 className="display mt-2 text-3xl">
        Budget is temporarily unavailable
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Your plan and financial data were not changed.
        Try loading this view again.
      </p>
      <button
        type="button"
        onClick={retry}
        className="mt-6 min-h-11 rounded-field bg-accent px-4 py-2 text-sm font-bold text-accent-foreground focus-visible:outline-2"
      >
        Try again
      </button>
    </main>
  );
}
