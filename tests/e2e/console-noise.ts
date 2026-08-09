/**
 * Console output the browser or the dev server produces that the app is not
 * responsible for. Specs that assert "no console errors or warnings" filter
 * through this so the assertion stays meaningful: every entry below is a
 * documented environment artifact, not a defect we have decided to tolerate.
 *
 * Not a dumping ground. Before adding an entry, prove the message is not the
 * app's fault, and record how.
 */
const KNOWN_NOISE: ReadonlyArray<{ reason: string; matches: (text: string) => boolean }> = [
  {
    reason:
      "Headless Chromium has no GPU, so ANGLE logs a fallback line on any page that touches WebGL.",
    matches: (text) => /^\[\.WebGL-/.test(text),
  },
  {
    reason: "WebGPU adapter probe in the same headless-GPU situation.",
    matches: (text) => text === "No available adapters.",
  },
  {
    reason:
      "Sandboxed runs cannot resolve external hosts (fonts, Plaid CDN). Nothing the app controls.",
    matches: (text) =>
      /^Failed to load resource: net::ERR_NAME_NOT_RESOLVED$/.test(text),
  },
  {
    reason:
      "React Strict Mode only, i.e. `next dev`. react-plaid-link's useScript " +
      "cleanup removes the <script> and deletes its module cache entry while the " +
      "script is still loading, so the Strict-Mode remount appends a second one — " +
      "and the first still executes, which is what Plaid's own script warns about. " +
      "Verified absent from a production build (`next build && next start`) on " +
      "2026-08-09, so it is not the app mounting Plaid Link twice. Revisit if " +
      "react-plaid-link ever fixes the cleanup.",
    matches: (text) =>
      text.includes(
        "Plaid link-initialize.js script was embedded more than once",
      ),
  },
];

export function isKnownEnvironmentNoise(text: string): boolean {
  return KNOWN_NOISE.some((entry) => entry.matches(text));
}
