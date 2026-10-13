"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Scrollable content gains a keyboard stop only while its container can scroll. */
export default function ScrollableRegion({ children, label, className }: Readonly<{
  children: ReactNode;
  label: string;
  className: string;
}>) {
  const regionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const region = regionRef.current;
    if (!region) return;
    const update = () => {
      const overflows = region.scrollWidth > region.clientWidth || region.scrollHeight > region.clientHeight;
      if (overflows) region.tabIndex = 0;
      else region.removeAttribute("tabindex");
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(region);
    for (const child of region.children) observer.observe(child);
    return () => { observer.disconnect(); };
  }, [children]);
  return <section ref={regionRef} aria-label={label} className={className}>{children}</section>;
}
