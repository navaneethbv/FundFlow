import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RegisterRow from "@/components/ui/RegisterRow";

const baseProps = {
  index: 0,
  merchant: "Corner Grocer",
  date: "2026-08-23",
  amount: -64.18,
  currency: "USD",
};

function renderRow(props: Partial<typeof baseProps> & Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement("ul", null, createElement(RegisterRow, { ...baseProps, ...props })),
  );
}

describe("RegisterRow", () => {
  it("shows the merchant and formatted amount", () => {
    const html = renderRow();
    expect(html).toContain("Corner Grocer");
    expect(html).toContain("$64.18");
  });

  it("renders an outflow with a minus sign and the negative diverging token", () => {
    const html = renderRow();
    expect(html).toContain("-$64.18");
    expect(html).toContain("var(--viz-neg)");
  });

  it("renders an inflow with a plus sign and the positive diverging token", () => {
    const html = renderRow({ amount: 2450 });
    expect(html).toContain("+$2,450.00");
    expect(html).toContain("var(--viz-pos)");
  });

  it("renders a zero amount flat — no sign and no direction color", () => {
    const html = renderRow({ amount: 0 });
    expect(html).toContain("$0.00");
    expect(html).not.toContain("+$0.00");
    expect(html).not.toContain("-$0.00");
    expect(html).not.toContain("var(--viz-pos)");
    expect(html).not.toContain("var(--viz-neg)");
  });

  it.each([
    ["negative zero", -0],
    ["rounds to zero", 0.004],
    ["negative rounds to zero", -0.004],
  ] as const)("renders %s as a neutral display zero", (_name, amount) => {
    const html = renderRow({ amount });
    expect(html).toContain("$0.00");
    expect(html).not.toContain("+$0.00");
    expect(html).not.toContain("-$0.00");
    expect(html).not.toContain("var(--viz-pos)");
    expect(html).not.toContain("var(--viz-neg)");
  });

  it("keeps a value that rounds to one cent signed and colored", () => {
    const html = renderRow({ amount: 0.005 });
    expect(html).toContain("+$0.01");
    expect(html).toContain("var(--viz-pos)");
  });

  it("zebra-stripes odd-indexed rows and not even-indexed rows", () => {
    expect(renderRow({ index: 1 })).toContain("bg-panel-2");
    expect(renderRow({ index: 0 })).not.toContain("bg-panel-2");
  });

  it("sets the date in the mono face", () => {
    const html = renderRow();
    expect(html).toContain('class="block text-xs text-muted font-mono"');
  });

  it("carries the amount inside the privacy-blur hook", () => {
    const html = renderRow();
    expect(html).toContain("data-money");
  });

  it("renders optional meta and trailing content", () => {
    const html = renderRow({
      meta: createElement("span", null, "Food & Drink"),
      trailing: createElement("span", null, "chevron"),
    });
    expect(html).toContain("Food &amp; Drink");
    expect(html).toContain("chevron");
  });
});
