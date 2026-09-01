import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Shell-stable loading skeletons (frontend-review R3): the AppShell must stay
 * mounted during route loading so navigation reads as content changing inside
 * a stable frame, and the skeleton itself is a hairline placeholder, not
 * motion.
 */

let shellProps: { active?: string; skeleton?: boolean } = {};
vi.mock("@/components/shell/AppShell", () => ({
  default: ({
    active,
    skeleton,
    children,
  }: {
    active: string;
    skeleton?: boolean;
    children: React.ReactNode;
  }) => {
    shellProps = { active, skeleton };
    return createElement("main", null, children);
  },
}));

import RouteSkeleton from "@/components/shell/RouteSkeleton";

describe("RouteSkeleton", () => {
  it("renders inside the AppShell with the route's active id", () => {
    shellProps = {};
    const html = renderToStaticMarkup(
      createElement(RouteSkeleton, { active: "transactions", label: "Transactions" }),
    );
    expect(shellProps.active).toBe("transactions");
    expect(html).toContain("aria-busy");
    expect(html).toContain("Loading Transactions");
  });

  it("tells AppShell to skip its Supabase-backed sidebar data so the fallback paints instantly", () => {
    shellProps = {};
    renderToStaticMarkup(
      createElement(RouteSkeleton, { active: "transactions", label: "Transactions" }),
    );
    expect(shellProps.skeleton).toBe(true);
  });

  it("uses restrained pulse placeholders on token surfaces, no JS animation", () => {
    const html = renderToStaticMarkup(
      createElement(RouteSkeleton, { active: "reports", label: "Reports" }),
    );
    expect(html).toContain("animate-pulse");
    expect(html).toContain("bg-panel-hover");
    const source = readFileSync("components/shell/RouteSkeleton.tsx", "utf8");
    expect(source).not.toMatch(/requestAnimationFrame|setInterval|setTimeout/);
  });
});

describe("loading.tsx coverage", () => {
  const routes = [
    "transactions",
    "dashboard",
    "reports",
    "accounts",
    "wrapped",
    "settings",
    "budget",
    "recurring",
    "cash-flow",
  ];

  it.each(routes)("has a shell-wrapped loading state: app/%s/loading.tsx", (route) => {
    const file = `app/${route}/loading.tsx`;
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, "utf8");
    expect(source, `${file} must render RouteSkeleton (shell stays mounted)`).toContain(
      "RouteSkeleton",
    );
  });
});
