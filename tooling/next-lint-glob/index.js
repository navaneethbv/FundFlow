import { globSync as tinyGlobSync } from "tinyglobby";
import { isAbsolute } from "node:path";

// Next 16.3.8 only uses this API, with onlyDirectories: true.
// Preserve fast-glob's literal-directory behavior instead of expanding subtrees.
export const globSync = (pattern, options) =>
  tinyGlobSync(pattern, { ...options, absolute: isAbsolute(pattern), expandDirectories: false })
    .map((path) => path.replace(/\/$/, "") || "/");
