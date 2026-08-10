import { describe, expect, it } from "vitest";
import { ADVICE_LIBRARY, ALLOWED_SOURCE_HOSTS, type AdviceContext } from "@/lib/advice-content";

describe("Advice Content Library", () => {
  it("defines non-empty advice library items with required fields", () => {
    expect(ADVICE_LIBRARY.length).toBeGreaterThan(0);
    for (const item of ADVICE_LIBRARY) {
      expect(item.id).toBeTruthy();
      expect(item.version).toBeGreaterThan(0);
      expect(item.title).toBeTruthy();
      expect(item.body).toBeTruthy();
      expect(item.tasks.length).toBeGreaterThan(0);
      expect(item.sources.length).toBeGreaterThan(0);
      for (const source of item.sources) {
        const url = new URL(source.url);
        expect(ALLOWED_SOURCE_HOSTS.some((host) => url.hostname.endsWith(host))).toBe(true);
      }
    }
  });

  it("evaluates relevantWhen predicates for context states", () => {
    const ctxLowRunway: AdviceContext = {
      runwayMonths: 1,
      hasBudget: false,
      hasGoals: false,
      creditCardCarry: true,
      hasInvestments: false,
    };

    const ctxHighRunway: AdviceContext = {
      runwayMonths: 6,
      hasBudget: true,
      hasGoals: true,
      creditCardCarry: false,
      hasInvestments: true,
    };

    for (const item of ADVICE_LIBRARY) {
      if (item.relevantWhen) {
        const lowRes = item.relevantWhen(ctxLowRunway);
        const highRes = item.relevantWhen(ctxHighRunway);
        expect(typeof lowRes).toBe("boolean");
        expect(typeof highRes).toBe("boolean");
      }
    }
  });
});
