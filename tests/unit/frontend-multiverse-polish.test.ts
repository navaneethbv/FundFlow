import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import Tabs from "@/components/ui/Tabs";
import DropdownButton from "@/components/ui/DropdownButton";
import Modal from "@/components/ui/Modal";
import ProgressBar from "@/components/ui/ProgressBar";
import SegmentedControl from "@/components/ui/SegmentedControl";
import RegisterRow from "@/components/ui/RegisterRow";
import EmptyState from "@/components/ui/EmptyState";

describe("Frontend Multiverse Polish: Motion & Keyframe Contracts", () => {
  it("defines micro-interaction keyframes in globals.css", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain("@keyframes modal-pop-in");
    expect(css).toContain("@keyframes sheet-slide-up");
    expect(css).toContain("@keyframes dropdown-pop-in");
    expect(css).toContain("@keyframes shimmer-wave");
  });

  it("defines animation utility classes and respects reduced motion", () => {
    const css = readFileSync("app/globals.css", "utf8");
    expect(css).toContain(".animate-modal-pop");
    expect(css).toContain(".animate-sheet-slide");
    expect(css).toContain(".animate-dropdown");
    expect(css).toContain(".animate-shimmer");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("animation-duration: 0.01ms !important");
  });
});

describe("Frontend Multiverse Polish: Tabs ARIA & Micro-physics", () => {
  it("renders with default and custom aria-label landmark", () => {
    const defaultHtml = renderToStaticMarkup(
      createElement(Tabs, {
        items: [
          { label: "Overview", href: "/reports", active: true },
          { label: "Income", href: "/reports?tab=income", active: false },
        ],
      }),
    );
    expect(defaultHtml).toContain('<nav aria-label="Tabs"');

    const customHtml = renderToStaticMarkup(
      createElement(Tabs, {
        ariaLabel: "Report categories",
        items: [{ label: "All", href: "/reports", active: true }],
      }),
    );
    expect(customHtml).toContain('<nav aria-label="Report categories"');
  });

  it("sets aria-current='page' on active tab and provides active:scale physics", () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        items: [
          { label: "Active", href: "/tab1", active: true },
          { label: "Inactive", href: "/tab2", active: false },
        ],
      }),
    );
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("active:scale-[0.98]");
  });
});

describe("Frontend Multiverse Polish: DropdownButton Semantics & Motion", () => {
  it("includes aria-haspopup on trigger and active physics", () => {
    const html = renderToStaticMarkup(
      createElement(DropdownButton, {
        label: "Timeframe",
        items: [{ label: "1 month", href: "/reports?m=1" }],
      }),
    );
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain("active:scale-[0.98]");
  });

  it("verifies DropdownButton source follows disclosure pattern with animate-dropdown", () => {
    const source = readFileSync("components/ui/DropdownButton.tsx", "utf8");
    expect(source).toContain('aria-haspopup="true"');
    expect(source).toContain("animate-dropdown");
    expect(source).not.toContain('role="menu"');
  });
});

describe("Frontend Multiverse Polish: Modal Bottom Sheet Affordance & Motion", () => {
  it("renders mobile grab handle and animate-sheet-slide for sheet placement", () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          onClose: () => undefined,
          placement: "sheet",
          ariaLabel: "Filter drawer",
        },
        createElement("div", null, "Sheet Content"),
      ),
    );
    expect(html).toContain("animate-sheet-slide");
    expect(html).toContain("sm:animate-modal-pop");
    expect(html).toContain("h-1 w-10 shrink-0 rounded-full bg-panel-border sm:hidden");
  });

  it("renders animate-modal-pop for centered placement without sheet grab handle", () => {
    const html = renderToStaticMarkup(
      createElement(
        Modal,
        {
          open: true,
          onClose: () => undefined,
          placement: "center",
          ariaLabel: "Center dialog",
        },
        createElement("div", null, "Modal Content"),
      ),
    );
    expect(html).toContain("animate-modal-pop");
    expect(html).not.toContain("animate-sheet-slide");
    expect(html).not.toContain("sm:hidden");
  });
});

describe("Frontend Multiverse Polish: ProgressBar Shimmer", () => {
  it("renders shimmer wave element when shimmer prop is enabled", () => {
    const htmlWithShimmer = renderToStaticMarkup(
      createElement(ProgressBar, {
        percent: 75,
        shimmer: true,
      }),
    );
    expect(htmlWithShimmer).toContain("animate-shimmer");

    const htmlWithoutShimmer = renderToStaticMarkup(
      createElement(ProgressBar, {
        percent: 75,
        shimmer: false,
      }),
    );
    expect(htmlWithoutShimmer).not.toContain("animate-shimmer");
  });
});

describe("Frontend Multiverse Polish: Interactive Primitives & Navigation", () => {
  it("SegmentedControl includes active:scale micro-physics", () => {
    const html = renderToStaticMarkup(
      createElement(SegmentedControl, {
        ariaLabel: "View Mode",
        items: [
          { label: "Grid", href: "/view?mode=grid", active: true },
          { label: "List", href: "/view?mode=list", active: false },
        ],
      }),
    );
    expect(html).toContain("active:scale-[0.98]");
  });

  it("RegisterRow provides hover transition, active press, and rounded-field styling", () => {
    const html = renderToStaticMarkup(
      createElement(RegisterRow, {
        index: 0,
        merchant: "Supermarket",
        date: "2026-09-01",
        amount: -45.5,
      }),
    );
    expect(html).toContain("rounded-field");
    expect(html).toContain("transition-colors");
    expect(html).toContain("active:scale-[0.99]");
  });

  it("EmptyState supports hover transition and accent border highlight", () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: "No transactions yet",
        description: "Connect your bank to begin syncing.",
      }),
    );
    expect(html).toContain("hover:border-accent/30");
    expect(html).toContain("transition-all");
  });

  it("MobileNavigation drawer carries grab handle indicator and animate-sheet-slide", () => {
    const source = readFileSync("components/shell/MobileNavigation.tsx", "utf8");
    expect(source).toContain("animate-sheet-slide");
    expect(source).toContain("h-1 w-10 shrink-0 rounded-full bg-panel-border");
    expect(source).toContain("active:scale-[0.98]");
  });

  it("SidebarShell incorporates smooth transition duration and active button feedback", () => {
    const source = readFileSync("components/shell/SidebarShell.tsx", "utf8");
    expect(source).toContain("duration-200 ease-in-out");
    expect(source).toContain("active:scale-95");
  });
});
