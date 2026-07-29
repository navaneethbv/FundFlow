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
});
