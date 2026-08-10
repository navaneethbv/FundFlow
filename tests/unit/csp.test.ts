import { describe, expect, it } from "vitest";
import { buildCsp, config } from "@/proxy";

describe("Content Security Policy", () => {
  it("allows React debugging eval only in development", () => {
    expect(buildCsp("test-nonce", true)).toContain("'unsafe-eval'");
    expect(buildCsp("test-nonce", false)).not.toContain("'unsafe-eval'");
  });

  it("serves the public service worker without an auth redirect", () => {
    expect(config.matcher[0]).toContain("sw\\.js");
  });

  // The manifest is public PWA metadata with no user data. Routing it through
  // the proxy 307s signed-out requests to /login, so the browser parses a login
  // page as JSON and reports "the manifest is not valid JSON data".
  it("serves the web app manifest without an auth redirect", () => {
    const matcher = new RegExp(config.matcher[0].replace(/^\/\(/, "^/(") + "$");
    expect(matcher.test("/manifest.webmanifest")).toBe(false);
    expect(matcher.test("/dashboard")).toBe(true);
  });
});
