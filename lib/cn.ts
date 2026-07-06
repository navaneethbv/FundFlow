import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class lists; later classes win on conflicts. Pure, client-safe. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
