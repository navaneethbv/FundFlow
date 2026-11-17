import type { ReactNode } from "react";

/** Native disclosure keeps secondary workflows reachable without a client bundle. */
export default function Disclosure({ title, open = false, children }: Readonly<{
  title: string; open?: boolean; children: ReactNode;
}>) {
  return <details open={open} className="rounded-card bg-panel px-4 py-3">
    <summary className="cursor-pointer text-sm font-medium focus-visible:outline-2">{title}</summary>
    <div className="mt-3 space-y-3">{children}</div>
  </details>;
}
