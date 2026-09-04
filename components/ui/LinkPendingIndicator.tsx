"use client";

import { useLinkStatus } from "next/link";

/** Fixed-size inline feedback for links whose route data is still loading. */
export default function LinkPendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      data-pending={pending ? "true" : "false"}
      className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-current border-t-transparent opacity-0 transition-opacity duration-150 data-[pending=true]:animate-spin data-[pending=true]:opacity-100"
    />
  );
}
