import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UserMenu from "@/components/shell/UserMenu";

describe("UserMenu hydration readiness", () => {
  it("does not accept an account-menu click before React can handle it", () => {
    const html = renderToStaticMarkup(
      createElement(UserMenu, {
        displayName: "Test User",
        email: "test@example.com",
      }),
    );

    expect(html).toContain('aria-label="Account menu for Test User"');
    expect(html).toContain("disabled");
  });
});
