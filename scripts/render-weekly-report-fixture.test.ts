import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { renderWeeklyReportEmail } from "@/lib/report-email";
import { generateWeeklyReportPdf } from "@/lib/report-pdf";
import { weeklyReportFixture } from "@/tests/fixtures/weekly-report";

describe("weekly report fixture artifacts", () => {
  it("writes deterministic email and PDF previews", async () => {
    const report = weeklyReportFixture({
      merchants: [
        {
          merchant: "Neighborhood Market With A Deliberately Long Display Name & Cafe",
          amount: 164.2,
        },
        ...weeklyReportFixture().merchants.slice(1),
      ],
    });
    const email = renderWeeklyReportEmail(
      report,
      "https://fundflow.example/dashboard",
    );
    const pdf = await generateWeeklyReportPdf(report);

    await Promise.all([
      writeFile("/tmp/fundflow-weekly-email.html", email.html, "utf8"),
      writeFile("/tmp/fundflow-weekly-report.pdf", pdf),
    ]);

    expect(email.html).toContain("weekly flow");
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
