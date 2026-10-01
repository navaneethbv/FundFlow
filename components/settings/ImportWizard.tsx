"use client";

import { useEffect, useState } from "react";

export function useImportFileDrop(enabled: boolean, busy: boolean, onFile: (file: File) => void, onError: (message: string) => void): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const over = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      if (busy) return;
      setActive(true);
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const drop = (event: DragEvent) => {
      if (event.defaultPrevented || !hasFiles(event)) return;
      event.preventDefault();
      setActive(false);
      if (busy) return;
      const files = event.dataTransfer?.files;
      if (files?.length !== 1) { onError("Drop one statement file at a time."); return; }
      onFile(files[0]!);
    };
    const leave = (event: DragEvent) => { if (event.relatedTarget === null) setActive(false); };
    const end = () => setActive(false);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragend", end);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragend", end);
    };
  }, [enabled, busy, onFile, onError]);
  return enabled && active;
}

export function ImportSteps({ hasFile, hasRows, completed }: Readonly<{ hasFile: boolean; hasRows: boolean; completed: boolean }>) {
  let current = 0;
  if (hasFile) current = 1;
  if (hasRows) current = 2;
  if (completed) current = 3;
  return (
    <ol aria-label="Import steps" className="mb-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
      {["Choose file", "Map and check", "Review", "Complete"].map((label, index) => (
        <li key={label} aria-current={index === current ? "step" : undefined} className={`rounded-field border p-2 ${index === current ? "border-accent font-semibold text-foreground" : "border-panel-border text-muted"}`}>
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}
