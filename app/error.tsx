"use client";

import RouteErrorView from "@/components/shell/RouteErrorView";

export default function RootError({
  error,
  retry,
}: Readonly<{
  error: Error & { digest?: string };
  retry: () => void;
}>) {
  return (
    <RouteErrorView
      context="Root"
      title="This view is temporarily unavailable"
      message="Something went wrong while loading this page. Your data was not changed. Try loading it again."
      error={error}
      retry={retry}
    />
  );
}
