import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import OwnerDot from "@/components/household/OwnerDot";

describe("OwnerDot", () => {
  it("renders an accessible label for the viewer's own rows", () => {
    const html = renderToStaticMarkup(createElement(OwnerDot, { ownerId: "owner-1", viewerId: "owner-1" }));
    expect(html).toContain('role="img"');
    expect(html).toContain("Owner: You");
  });

  it("renders a household label and stays stable for a member id", () => {
    const first = renderToStaticMarkup(createElement(OwnerDot, { ownerId: "owner-2", viewerId: "owner-1" }));
    const second = renderToStaticMarkup(createElement(OwnerDot, { ownerId: "owner-2", viewerId: "owner-1" }));
    expect(first).toContain("Owner: Household member");
    expect(first).toBe(second);
  });
});
