"use client";

import { useState, type ReactNode } from "react";
import WidgetShell from "@/components/dashboard/widgets/WidgetShell";

/** Local view controls compose server-rendered content without fetching or writing data. */
export default function WidgetChoice({ title, label, error, options }: Readonly<{
  title: string; label: string; error?: string | null;
  options: { value: string; label: string; content: ReactNode }[];
}>) {
  const [value, setValue] = useState(options.at(0)?.value ?? "");
  const selected = options.find(option => option.value === value) ?? options.at(0);
  return <WidgetShell title={title} error={error} action={
    <select aria-label={label} value={selected?.value ?? ""} onChange={event => { setValue(event.target.value); }}
      className="min-h-11 max-w-full rounded-field border border-panel-border bg-panel px-3 text-sm pointer-fine:min-h-9">
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  }>{selected?.content}</WidgetShell>;
}
