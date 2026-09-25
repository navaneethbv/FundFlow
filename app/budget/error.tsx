"use client";

import RouteErrorView from "@/components/shell/RouteErrorView";

export default function BudgetError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <RouteErrorView
      context="Budget"
      eyebrow="Budget"
      title="Budget is temporarily unavailable"
      message="Your plan and financial data were not changed. Try loading this view again."
      error={error}
      retry={retry}
    />
  );
}
