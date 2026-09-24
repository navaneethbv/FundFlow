"use client";

import RouteErrorView from "@/components/shell/RouteErrorView";

export default function CashFlowError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <RouteErrorView
      context="Cash flow"
      eyebrow="Cash Flow"
      title="Cash Flow is temporarily unavailable"
      message="Your financial data was not changed. Try loading this view again."
      error={error}
      retry={retry}
    />
  );
}
