import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("transactions UI restyle", () => {
  it("uses shared primitives without changing GET filter behavior", () => {
    const source = readFileSync("app/transactions/page.tsx", "utf8");

    expect(source).toContain("method=\"get\"");
    expect(source).toContain("action=\"/transactions\"");
    expect(source).toContain("Panel");
    expect(source).toContain("Input");
    expect(source).toContain("Select");
    expect(source).toContain("Badge");
    expect(source).toContain("ButtonLink");
    expect(source).toContain("sticky top-0");
  });
});
