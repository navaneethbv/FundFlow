"use client";

import RouteErrorView from "@/components/shell/RouteErrorView";

export default function RecurringError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <RouteErrorView
      context="Recurring"
      eyebrow="Recurring"
      title="Recurring is temporarily unavailable"
      message="Your recurring streams were not changed. Try loading this view again."
      error={error}
      retry={retry}
    />
  );
}
