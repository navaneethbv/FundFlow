import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Modal from "@/components/ui/Modal";
import CommandPalette from "@/components/CommandPalette";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

describe("Modal placement variants", () => {
  it("renders centered modal by default", () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          onClose: vi.fn(),
          titleId: "test-title",
        },
        createElement("div", null, "Modal content"),
      ),
    );
    expect(html).toContain("items-center p-4");
    expect(html).toContain("rounded-card");
    expect(html).not.toContain("rounded-t-card");
  });

  it("renders mobile-first bottom-sheet when placement is sheet", () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          onClose: vi.fn(),
          placement: "sheet",
          titleId: "test-title",
        },
        createElement("div", null, "Sheet content"),
      ),
    );
    expect(html).toContain("items-end p-0 sm:items-center sm:p-4");
    expect(html).toContain("rounded-t-card sm:rounded-card");
  });
});

describe("TransactionEditor sheet placement", () => {
  it("passes placement sheet to Modal primitive", () => {
    const source = readFileSync("components/transactions/TransactionEditor.tsx", "utf8");
    expect(source).toContain('placement="sheet"');
  });
});

describe("CommandPalette empty state a11y", () => {
  it("does not render listbox with role option when no commands match", () => {
    const html = renderToStaticMarkup(
      createElement(CommandPalette, { items: [] }),
    );
    // When closed, nothing renders
    expect(html).toBe("");

    const source = readFileSync("components/CommandPalette.tsx", "utf8");
    // Ensure the empty state is a paragraph, not a listbox option
    expect(source).toContain('<p className="px-4 py-6 text-center text-sm text-muted">No matches.</p>');
    expect(source).not.toContain('<li role="option" aria-disabled');
  });
});

describe("Sidebar collapse cookie persistence", () => {
  it("SidebarShell sets document.cookie on toggle", () => {
    const source = readFileSync("components/shell/SidebarShell.tsx", "utf8");
    expect(source).toContain("sidebar_collapsed=");
    expect(source).toContain("setSidebarCollapsedCookie");
  });

  it("AppSidebar reads sidebar_collapsed cookie", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).toContain('cookies()');
    expect(source).toContain('sidebar_collapsed');
  });
});
