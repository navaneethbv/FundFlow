"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

/** Native keyboard-accessible selector over server-authored, same-app URLs. */
export default function RouteSelect({ label, value, options }: Readonly<{
  label: string;
  value: string;
  options: { label: string; href: string }[];
}>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="min-w-0 max-w-full">
      <span className="sr-only">{label}</span>
      <select aria-busy={pending} disabled={pending} value={value}
        className="min-h-11 max-w-full rounded-field border border-panel-border bg-panel px-3 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-accent pointer-fine:min-h-9 sm:max-w-64"
        onChange={event => {
          const href = event.currentTarget.value;
          if (!href.startsWith("/") || href.startsWith("//") || !options.some(option => option.href === href)) return;
          startTransition(() => router.push(href, { scroll: false }));
        }}>
        {options.map(option => <option key={option.href} value={option.href}>{option.label}</option>)}
      </select>
    </label>
  );
}
