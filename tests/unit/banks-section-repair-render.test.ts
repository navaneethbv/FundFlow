import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const { default: BanksSection } = await import(
  "@/components/settings/BanksSection"
);

const item = {
  id: "item-1",
  institution_name: "Chase Bank",
  status: "active",
  error_code: null,
};

describe("BanksSection repair controls", () => {
  it("renders a Repair control for each institution row", () => {
    const html = renderToStaticMarkup(
      createElement(BanksSection, { initialItems: [item, { ...item, id: "item-2" }] }),
    );
    expect(html.match(/Repair/g)).toHaveLength(2);
  });

  it("shows repair controls without leaking item identifiers in markup", () => {
    const html = renderToStaticMarkup(
      createElement(BanksSection, { initialItems: [item] }),
    );
    expect(html).not.toContain("plaid-item");
    expect(html).toContain("Repair");
  });
});