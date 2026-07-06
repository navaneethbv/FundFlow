import { describe, it, expect } from "vitest";
import { isCrossOrigin } from "@/lib/origin";

describe("isCrossOrigin", () => {
  it("passes a same-origin request", () => {
    expect(isCrossOrigin("https://fundflow.app", "fundflow.app")).toBe(false);
    expect(isCrossOrigin("http://localhost:3000", "localhost:3000")).toBe(false);
  });

  it("blocks a cross-site origin", () => {
    expect(isCrossOrigin("https://evil.example", "fundflow.app")).toBe(true);
  });

  it("blocks a same-domain but different-port origin", () => {
    expect(isCrossOrigin("http://localhost:4000", "localhost:3000")).toBe(true);
  });

  it("passes when no Origin header is present (non-browser callers)", () => {
    expect(isCrossOrigin(null, "fundflow.app")).toBe(false);
  });

  it('blocks the opaque "null" origin and malformed values', () => {
    expect(isCrossOrigin("null", "fundflow.app")).toBe(true);
    expect(isCrossOrigin("not a url", "fundflow.app")).toBe(true);
  });
});
