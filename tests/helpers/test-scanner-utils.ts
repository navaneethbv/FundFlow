import { readdirSync, readFileSync, statSync } from "node:fs";

export interface ScanOptions {
  extensions?: string[];
  ignorePrefix?: string;
}

/**
 * Recursively walks a directory and returns matching file paths.
 */
export function walkFiles(
  dir: string,
  options: ScanOptions = { extensions: [".ts", ".tsx"], ignorePrefix: "_" },
): string[] {
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (options.ignorePrefix && entry.startsWith(options.ignorePrefix)) continue;
    const full = `${dir}/${entry}`;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walkFiles(full, options));
    } else if (
      !options.extensions ||
      options.extensions.some((ext) => full.endsWith(ext))
    ) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Recursively scans files in a directory and returns paths where predicate returns true.
 */
export function scanFileContents(
  dir: string,
  predicate: (content: string, path: string) => boolean,
  options?: ScanOptions,
): string[] {
  const files = walkFiles(dir, options);
  const offenders: string[] = [];
  for (const file of files) {
    const content = readFileSync(file, "utf8");
    if (predicate(content, file)) {
      offenders.push(file);
    }
  }
  return offenders;
}

/**
 * Recursively scans files in a directory for regex pattern match.
 */
export function scanPattern(
  dir: string,
  pattern: RegExp,
  options?: ScanOptions,
): string[] {
  return scanFileContents(dir, (content) => pattern.test(content), options);
}
