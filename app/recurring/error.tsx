"use client";

export default function RecurringError({
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <main className="mx-auto max-w-xl px-4 py-16 text-center">
      <p className="eyebrow">Recurring</p>
      <h1 className="display mt-2 text-3xl">
        Recurring is temporarily unavailable
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Your recurring streams were not changed.
        Try loading this view again.
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
