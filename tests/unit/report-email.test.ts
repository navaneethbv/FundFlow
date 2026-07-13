import { describe, expect, it } from "vitest";
import {
  escapeEmailHtml,
  renderDailyDigestEmail,
  renderWeeklyReportEmail,
} from "@/lib/report-email";
import { weeklyReportFixture } from "@/tests/fixtures/weekly-report";

describe("weekly report email", () => {
  it("renders visual report sections with a plain-text alternative", () => {
    const rendered = renderWeeklyReportEmail(
      weeklyReportFixture(),
      "https://fundflow.example/dashboard",
    );

    expect(rendered.subject).toContain("July 6-12");
    expect(rendered.html).toContain("Category breakdown");
    expect(rendered.html).toContain("Banks and credit cards");
    expect(rendered.html).toContain("Budget pacing");
    expect(rendered.html).toContain("Cash flow");
    expect(rendered.html).toContain("width:");
    expect(rendered.html).toContain("https://fundflow.example/dashboard");
    expect(rendered.text).toContain("Previous Monday through Sunday");
    expect(rendered.text).toContain("Sapphire Reserve");
  });

  it("escapes user-influenced strings and omits sensitive account details", () => {
    const rendered = renderWeeklyReportEmail(
      weeklyReportFixture({
        merchants: [
          { merchant: '<img src=x onerror="alert(1)">', amount: 40 },
        ],
        cards: [{ name: "Private Card 4242", amount: 40 }],
      }),
      "https://fundflow.example/dashboard",
    );

    expect(escapeEmailHtml("<script>&\"")).toBe(
      '&lt;script&gt;&amp;&quot;',
    );
    expect(rendered.html).toContain("&lt;img");
    expect(rendered.html).not.toContain("<img");
    expect(rendered.html).not.toContain("4242");
    expect(rendered.text).not.toContain("4242");
    expect(rendered.html).not.toContain("access_token");
  });

  it("escapes daily digest notification content", () => {
    const rendered = renderDailyDigestEmail(
      [
        {
          type: "broken_bank",
          title: "Bank <offline>",
          body: "Reconnect & retry",
        },
      ],
      "2026-07-13",
      "https://fundflow.example/notifications",
    );

    expect(rendered.html).toContain("Bank &lt;offline&gt;");
    expect(rendered.html).toContain("Reconnect &amp; retry");
    expect(rendered.html).not.toContain("Bank <offline>");
  });
});
