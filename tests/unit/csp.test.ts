import { describe, expect, it } from "vitest";
import { buildCsp, config, supabaseConnectSources } from "@/proxy";

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

describe("supabaseConnectSources", () => {
  it("keeps a hosted project on https and wss", () => {
    expect(supabaseConnectSources("https://abc.supabase.co")).toEqual({
      sources: "https://abc.supabase.co wss://abc.supabase.co",
      insecureLoopback: false,
    });
  });

  it("allows the plain-http local stack on loopback only", () => {
    expect(supabaseConnectSources("http://127.0.0.1:54321")).toEqual({
      sources: "http://127.0.0.1:54321 ws://127.0.0.1:54321",
      insecureLoopback: true,
    });
    expect(supabaseConnectSources("http://localhost:54321").insecureLoopback).toBe(true);
  });

  it("never allows plain http to a non-loopback host", () => {
    expect(supabaseConnectSources("http://db.example.com").sources).toBe(
      "https://db.example.com wss://db.example.com",
    );
  });

  it("keeps upgrade-insecure-requests for a hosted project", () => {
    expect(buildCsp("n", false)).toContain("upgrade-insecure-requests");
  });
});
