"use client";

import { AlertTriangle } from "@/components/ui/icons";

export default function ReviewBanner({ count }: Readonly<{ count: number }>) {
  if (count <= 0) return null;

  return (
    <div className="flex items-center justify-between rounded-panel border border-amber-500/20 bg-amber-500/10 px-5 py-4 text-amber-600 dark:text-amber-400">
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 shrink-0" />
        <span className="text-sm font-medium">
          There {count === 1 ? "is" : "are"} {count} new recurring merchant{count === 1 ? "" : "s"} for you to review.
        </span>
      </div>
    </div>
  );
}
