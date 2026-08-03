import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import SettingsLayout from "@/components/settings/SettingsLayout";

describe("SettingsLayout", () => {
  it("splits the nav into Account and Household cards", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, { active: "profile" }, "BODY"),
    );
    expect(html).toContain("Account");
    expect(html).toContain("Household");
    // Account-group sections.
    expect(html).toContain("Profile");
    expect(html).toContain("Display");
    expect(html).toContain("Notifications");
    expect(html).toContain("Security");
    expect(html).toContain("Integrations");
    // Household-group sections.
    expect(html).toContain("Settle up");
    expect(html).toContain("Institutions");
    expect(html).toContain("Tags");
  });

  it("puts Profile before Display in document order (Account group ordering preserved)", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, { active: "profile" }, "BODY"),
    );
    expect(html.indexOf(">Profile<")).toBeLessThan(html.indexOf(">Display<"));
  });

  it("marks the active section with aria-current", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, { active: "security" }, "BODY"),
    );
    expect(html).toMatch(/aria-current="page"[^>]*>\s*Security|href="\/settings\?section=security" aria-current="page"/);
  });

  it("omits a hidden section from both groups", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, { active: "profile", hiddenSections: ["tags"] }, "BODY"),
    );
    expect(html).not.toContain(">Tags<");
  });

  it("renders the page content passed as children", () => {
    const html = renderToStaticMarkup(
      createElement(SettingsLayout, { active: "profile" }, "PAGE_BODY_CONTENT"),
    );
    expect(html).toContain("PAGE_BODY_CONTENT");
  });
});
