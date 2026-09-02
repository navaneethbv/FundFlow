import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import Modal from "@/components/ui/Modal";
import CommandPalette from "@/components/CommandPalette";
import {
  SIDEBAR_COLLAPSED_COOKIE,
  clearSidebarCollapsedCookie,
  writeSidebarCollapsedCookie,
} from "@/lib/sidebar-collapsed-cookie";

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
  it("caps height and scrolls so a tall sheet never overflows off-screen", () => {
    // A sheet is pinned to the bottom of a `fixed inset-0` container that
    // does not scroll, so content taller than the viewport pushes its first
    // fields above the top edge with no way to reach them. The primitive
    // must contain that itself — AddTransactionModal (seven fields) and
    // AddManualHoldingForm pass no className of their own.
    for (const placement of ["center", "sheet"] as const) {
      const html = renderToStaticMarkup(
        createElement(
          Modal,
          { open: true, onClose: vi.fn(), placement, titleId: "t" },
          createElement("div", null, "content"),
        ),
      );
      expect(html, `${placement} placement`).toContain("max-h-[90vh]");
      expect(html, `${placement} placement`).toContain("overflow-y-auto");
    }
  });

  it("lets a caller override the default height cap", () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          onClose: vi.fn(),
          className: "max-h-[70vh]",
          titleId: "t",
        },
        createElement("div", null, "content"),
      ),
    );
    expect(html).toContain("max-h-[70vh]");
    expect(html).not.toContain("max-h-[90vh]");
  });
});

describe("GoalWizard focus restoration", () => {
  it("keeps its trigger mounted while open", () => {
    const source = readFileSync("components/goals/GoalWizard.tsx", "utf8");
    // useDialogFocus restores focus to whatever was focused when the dialog
    // opened. If the trigger unmounts on open, that saved node is detached
    // by the time the effect runs and closing drops focus to <body>. The
    // trigger must therefore sit outside the `{open && ...}` guard.
    const triggerIndex = source.indexOf("Add goal");
    const guardIndex = source.indexOf("{open && (");
    expect(triggerIndex, "trigger not found").toBeGreaterThan(-1);
    expect(guardIndex, "open guard not found").toBeGreaterThan(-1);
    expect(triggerIndex).toBeLessThan(guardIndex);
    expect(source).not.toContain("if (!open) {");
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
  it("writes the cookie with a one-year lifetime and clears it on request", () => {
    const jar: string[] = [];
    vi.stubGlobal("document", {
      set cookie(value: string) {
        jar.push(value);
      },
      get cookie() {
        return jar.join("; ");
      },
    });
    vi.stubGlobal("location", { protocol: "https:" });

    writeSidebarCollapsedCookie(true);
    expect(jar[0]).toContain(`${SIDEBAR_COLLAPSED_COOKIE}=true`);
    expect(jar[0]).toContain("max-age=31536000");
    expect(jar[0]).toContain("SameSite=Lax");
    expect(jar[0]).toContain("Secure");

    clearSidebarCollapsedCookie();
    expect(jar[1]).toContain(`${SIDEBAR_COLLAPSED_COOKIE}=;`);
    expect(jar[1]).toContain("max-age=0");

    vi.unstubAllGlobals();
  });

  it("omits Secure off https so the cookie still sets on localhost", () => {
    const jar: string[] = [];
    vi.stubGlobal("document", {
      set cookie(value: string) {
        jar.push(value);
      },
      get cookie() {
        return jar.join("; ");
      },
    });
    vi.stubGlobal("location", { protocol: "http:" });

    writeSidebarCollapsedCookie(false);
    expect(jar[0]).not.toContain("Secure");

    vi.unstubAllGlobals();
  });

  it("SidebarShell persists the collapse choice through the shared helper", () => {
    const source = readFileSync("components/shell/SidebarShell.tsx", "utf8");
    expect(source).toContain("writeSidebarCollapsedCookie");
  });

  it("AppSidebar reads the cookie so the skeleton paints the right width", () => {
    const source = readFileSync("components/shell/AppSidebar.tsx", "utf8");
    expect(source).toContain("cookies()");
    expect(source).toContain("SIDEBAR_COLLAPSED_COOKIE");
  });

  it("LogoutButton clears the cookie so a shared browser does not leak layout", () => {
    const source = readFileSync("components/LogoutButton.tsx", "utf8");
    expect(source).toContain("clearSidebarCollapsedCookie()");
  });
});
