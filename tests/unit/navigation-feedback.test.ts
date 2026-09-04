import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("navigation feedback", () => {
  it("provides a shared pending indicator for slow links", () => {
    const source = readFileSync("components/ui/LinkPendingIndicator.tsx", "utf8");
    expect(source).toContain("useLinkStatus");
    expect(source).toContain('data-pending={pending ? "true" : "false"}');
  });

  it("keeps route fallbacks mounted for every planning route", () => {
    for (const [route, label] of [
      ["goals", "Goals"],
      ["investments", "Investments"],
      ["debt", "Debt payoff"],
      ["forecasting", "Forecasting"],
      ["advice", "Advice"],
      ["notifications", "Notifications"],
    ]) {
      const source = readFileSync(`app/${route}/loading.tsx`, "utf8");
      expect(source).toContain("RouteSkeleton");
      expect(source).toContain(`label=\"${label}\"`);
    }
  });

  it("does not inject fictional FIRE scenarios into the forecasting page", () => {
    const page = readFileSync("app/forecasting/page.tsx", "utf8");
    const simulator = readFileSync("components/forecasting/FireSimulator.tsx", "utf8");
    expect(page).not.toContain("FireSimulator");
    expect(simulator).not.toContain("DEFAULT_EVENTS");
  });
});
