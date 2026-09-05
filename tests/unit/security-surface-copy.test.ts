import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AuditLogSection from "@/components/settings/AuditLogSection";
import SessionsSection from "@/components/settings/SessionsSection";
import { formatTimestampUtc } from "@/lib/format-date";

describe("export copy accuracy (FF-07)", () => {
  const exportSection = readFileSync("components/settings/ExportSection.tsx", "utf8");

  it("stops claiming the export carries no identifiers while merchant text is kept", () => {
    // The old copy read "no account numbers or identifiers", which a merchant
    // column of the user's own transaction text does not honour.
    expect(exportSection).not.toMatch(/no account numbers or identifiers/);
    expect(exportSection).toMatch(/Merchant names are your own transaction text/);
  });

  it("still names the fields the export genuinely excludes", () => {
    expect(exportSection).toMatch(/no balances, account numbers, masks or provider ids/);
  });

  it("keeps the route docs consistent with the UI copy", () => {
    for (const route of [
      "app/api/export/csv/route.ts",
      "app/api/export/tax/route.ts",
      "app/api/export/report-csv/route.ts",
    ]) {
      expect(readFileSync(route, "utf8")).toMatch(/verbatim/);
    }
  });
});

describe("security surface timestamps (FF-27)", () => {
  it("renders each session's last-active time, which is what distinguishes them", () => {
    const html = renderToStaticMarkup(
      createElement(SessionsSection, {
        initialSessions: [
          {
            id: "s1",
            label: "Chrome on Mac",
            current: false,
            lastSeenAt: "2026-07-02T09:30:00Z",
          },
          {
            id: "s2",
            label: "Chrome on Mac",
            current: true,
            lastSeenAt: "2026-07-01T08:00:00Z",
          },
        ],
      }),
    );

    expect(html).toContain('dateTime="2026-07-02T09:30:00Z"');
    expect(html).toContain(formatTimestampUtc("2026-07-02T09:30:00Z"));
    expect(html).toContain(formatTimestampUtc("2026-07-01T08:00:00Z"));
  });

  it("says so plainly when a session has no recorded last-active time", () => {
    const html = renderToStaticMarkup(
      createElement(SessionsSection, {
        initialSessions: [{ id: "s1", label: "Chrome", current: false, lastSeenAt: null }],
      }),
    );
    expect(html).toContain("Unknown time");
  });

  it("renders the timestamp on each audit row", () => {
    const html = renderToStaticMarkup(
      createElement(AuditLogSection, {
        initialRows: [
          { action: "login", metadata: {}, createdAt: "2026-07-02T09:30:00Z" },
        ],
      }),
    );

    expect(html).toContain('dateTime="2026-07-02T09:30:00Z"');
    expect(html).toContain(formatTimestampUtc("2026-07-02T09:30:00Z"));
  });

  it("marks an audit row with no timestamp rather than rendering a blank", () => {
    const html = renderToStaticMarkup(
      createElement(AuditLogSection, {
        initialRows: [{ action: "login", metadata: {}, createdAt: null }],
      }),
    );
    expect(html).toContain("Unknown time");
  });
});

describe("formatTimestampUtc", () => {
  it("formats in UTC so server and client markup agree", () => {
    expect(formatTimestampUtc("2026-07-02T09:30:00Z")).toBe("Jul 2, 2026, 9:30 AM UTC");
  });

  it("reports an absent or unparseable value instead of an Invalid Date", () => {
    expect(formatTimestampUtc(null)).toBe("Unknown time");
    expect(formatTimestampUtc(undefined)).toBe("Unknown time");
    expect(formatTimestampUtc("")).toBe("Unknown time");
    expect(formatTimestampUtc("not a date")).toBe("Unknown time");
  });
});

describe("single import workflow (FF-26)", () => {
  it("settings renders only the review-based import, not both doors to the same job", () => {
    const page = readFileSync("app/settings/page.tsx", "utf8");
    expect(page).toContain("<ImportReviewSection");
    expect(page).not.toMatch(/<ImportSection\b/);
    expect(page).not.toContain('from "@/components/settings/ImportSection"');
  });
});
