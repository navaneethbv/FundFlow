import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SegmentedControl from "@/components/ui/SegmentedControl";
import DropdownButton from "@/components/ui/DropdownButton";
import ProgressBar from "@/components/ui/ProgressBar";
import { MerchantAvatar, InstitutionAvatar } from "@/components/ui/Avatar";
import CategoryChip from "@/components/ui/CategoryChip";

describe("SegmentedControl", () => {
  it("renders every item as a real link and marks the active one", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        ariaLabel: "Horizon",
        items: [
          { label: "Month", href: "/budget?horizon=monthly", active: true },
          { label: "Year", href: "/budget?horizon=yearly", active: false },
        ],
      }),
    );
    expect(html).toContain('href="/budget?horizon=monthly"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("Month");
    expect(html).toContain("Year");
  });
});

describe("DropdownButton", () => {
  it("renders the closed trigger without the menu", () => {
    const html = renderToStaticMarkup(
      createElement(DropdownButton, {
        label: "Expenses",
        items: [{ label: "Income", href: "/reports?tab=income" }],
      }),
    );
    expect(html).toContain("Expenses");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="menu"');
  });
});

describe("ProgressBar", () => {
  it("clamps percent into 0-100 and exposes it as a numeric progressbar by default", () => {
    const over = renderToStaticMarkup(createElement(ProgressBar, { percent: 140 }));
    expect(over).toContain('role="progressbar"');
    expect(over).toContain('aria-valuenow="100"');
    expect(over).toContain("width:100%");

    const under = renderToStaticMarkup(createElement(ProgressBar, { percent: -20 }));
    expect(under).toContain('aria-valuenow="0"');
  });

  it("becomes a described image instead of a numeric progressbar when given a label", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressBar, { percent: 62, label: "62% funded" }),
    );
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="62% funded"');
    expect(html).not.toContain('role="progressbar"');
  });

  it("uses the tone's token class for the fill", () => {
    const html = renderToStaticMarkup(createElement(ProgressBar, { percent: 50, tone: "danger" }));
    expect(html).toContain("bg-danger");
  });

  it("names which bar it is on the numeric variant via ariaLabel, without switching to role=img", () => {
    const html = renderToStaticMarkup(
      createElement(ProgressBar, { percent: 40, ariaLabel: "Income progress" }),
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Income progress"');
  });
});

describe("Avatar (MerchantAvatar / InstitutionAvatar)", () => {
  it("renders the first letter of the name when there is no logo", () => {
    const html = renderToStaticMarkup(createElement(MerchantAvatar, { name: "Brightwheel" }));
    expect(html).toContain("B");
    expect(html).not.toContain("<img");
  });

  it("renders a logo image when a logoUrl is provided, no initial fallback", () => {
    const html = renderToStaticMarkup(
      createElement(InstitutionAvatar, { name: "Chase", logoUrl: "https://example.com/chase.png" }),
    );
    expect(html).toContain("<img");
    expect(html).toContain("https://example.com/chase.png");
  });

  it("picks the same hue for the same name every time (deterministic)", () => {
    const first = renderToStaticMarkup(createElement(MerchantAvatar, { name: "PayPal" }));
    const second = renderToStaticMarkup(createElement(MerchantAvatar, { name: "PayPal" }));
    expect(first).toBe(second);
  });

  it("falls back to a question mark for a blank name rather than an empty disc", () => {
    const html = renderToStaticMarkup(createElement(MerchantAvatar, { name: "   " }));
    expect(html).toContain("?");
  });
});

describe("CategoryChip", () => {
  it("prefixes a known category with its emoji", () => {
    const html = renderToStaticMarkup(createElement(CategoryChip, { label: "Shopping" }));
    expect(html).toContain("🛍️");
    expect(html).toContain("Shopping");
  });

  it("renders the label alone when the category has no mapped emoji", () => {
    const html = renderToStaticMarkup(
      createElement(CategoryChip, { label: "Some Brand New Category" }),
    );
    expect(html).toContain("Some Brand New Category");
  });
});
