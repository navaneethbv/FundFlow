import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import NetWorthHero from "@/components/accounts/NetWorthHero";
import type { AccountsPageData } from "@/lib/accounts-page";
type Summary = AccountsPageData["summary"];
function render(
  series: Summary["netWorthSeries"],
  currencies = Object.keys(series),
) {
  const summary = {
    currencies,
    netWorth: [],
    netWorthMonthChange: {},
    netWorthSeries: series,
  } as unknown as Summary;
  return renderToStaticMarkup(
    createElement(NetWorthHero, { summary, historyStartsOn: null }),
  );
}
it("distinguishes estimated history without labelling observed points as estimates", () => {
  const html = render({
    USD: [
      { date: "2026-09-29", value: 100, labels: ["Observed"] },
      { date: "2026-09-30", value: 200, estimated: true, labels: ["Estimate"] },
      { date: "2026-10-01", value: 300 },
    ],
  });
  expect(html.match(/stroke-dasharray="5 4"/g)).toHaveLength(2);
  expect(html.match(/<circle/g)).toHaveLength(1);
  expect(html).toContain("History notes");
  expect(html).toContain("Estimate: 2026-09-30");
  expect(html).toContain("Observed</td>");
  expect(html).toContain("Estimate</td>");
});
it("retains currencies separately rather than inventing an eighth chart color", () => {
  const series = Object.fromEntries(
    ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF", "INR"].map((currency) => [
      currency,
      [{ date: "2026-10-01", value: 1 }],
    ]),
  );
  const html = render(series);
  expect(html).toContain("daily balance table for all currencies");
  expect(html).not.toContain("<svg");
  for (const currency of Object.keys(series))
    expect(html).toContain(`${currency}</td>`);
});
it("supports equal values, no account currencies, and mixed source availability", () => {
  expect(render({})).toBe("");
  const html = render({
    USD: [
      { date: "2026-09-30", value: 100 },
      { date: "2026-10-01", value: 100 },
    ],
  });
  expect(html).toContain("<svg");
  expect(html).not.toContain("NaN");
  expect(html).not.toContain("stroke-dasharray");
  expect(html).not.toContain("History notes");
});
