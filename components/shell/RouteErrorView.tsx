"use client";

import { useEffect } from "react";
import Button from "@/components/ui/Button";
import ButtonLink from "@/components/ui/ButtonLink";
import { AlertTriangle } from "@/components/ui/icons";

/**
 * Shared body for every route error boundary. Error boundaries render outside
 * AppShell, so this stands alone: what happened, what was not affected, and
 * two ways out (retry in place, or leave for the dashboard).
 *
 * Only the digest is logged, never `error.message`, which can carry
 * server-side detail in development builds.
 */
export default function RouteErrorView({
  context,
  eyebrow = "FundFlow",
  title,
  message,
  error,
  retry,
}: Readonly<{
  context: string;
  eyebrow?: string;
  title: string;
  message: string;
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  useEffect(() => {
    console.error(`${context} error boundary caught`, error.digest ?? error.message);
  }, [context, error]);

  return (
    <main id="main-content" tabIndex={-1} className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertTriangle aria-hidden className="h-5 w-5" />
      </div>
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">{message}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={retry}>
          Try again
        </Button>
        <ButtonLink href="/dashboard">Go to dashboard</ButtonLink>
      </div>
      {error.digest && (
        <p className="mt-6 text-xs text-muted">
          Reference <span className="tabular-nums">{error.digest}</span>
        </p>
      )}
    </main>
  );
}
