import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ReportControls from "@/components/reports/ReportControls";
import { defaultReportFilters } from "@/lib/reports";

const filters = {
  ...defaultReportFilters("2026-10"),
  sort: "amount" as const,
  direction: "asc" as const,
  accounts: ["checking", "savings"],
};

describe("report date navigation", () => {
  it("preserves sort and direction when applying a custom date range", () => {
    const html = renderToStaticMarkup(createElement(ReportControls, { filters, today: "2026-10-03" }));
    expect(html).toContain('name="sort" value="amount"');
    expect(html).toContain('name="dir" value="asc"');
  });
});

it("keeps currency, scope, repeated filters and ordering in every navigation link", () => {
  const html = renderToStaticMarkup(createElement(ReportControls, {
    filters: { ...filters, scope: "household", merchants: ["Shop & Co"], categories: ["Food"], excludePending: true },
    today: "2026-10-03", currency: "EUR", householdId: "household",
  }));
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => new URL(m[1]!.replaceAll("&amp;", "&"), "https://fundflow.test"));
  expect(links.length).toBeGreaterThan(5);
  for (const link of links) {
    expect(link.searchParams.get("currency")).toBe("EUR");
    expect(link.searchParams.has("page")).toBe(false);
  }
  const quarter = links.find((link) => link.searchParams.get("end") === "2026-12-31")!;
  expect(quarter.searchParams.getAll("account")).toEqual(["checking", "savings"]);
  expect(quarter.searchParams.get("scope")).toBe("household");
  expect(quarter.searchParams.get("sort")).toBe("amount");
  expect(quarter.searchParams.get("dir")).toBe("asc");
  expect(quarter.searchParams.get("pending")).toBe("exclude");
  expect(quarter.searchParams.getAll("merchant")).toEqual(["Shop & Co"]);
  expect(html).toContain('name="currency" value="EUR"');
});
