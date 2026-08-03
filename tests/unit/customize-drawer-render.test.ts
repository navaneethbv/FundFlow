import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DashboardWidgetPrefs } from "@/lib/dashboard-widgets";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import CustomizeDrawer from "@/components/dashboard/CustomizeDrawer";
import DashboardHeaderActions from "@/components/dashboard/DashboardHeaderActions";

const prefs: DashboardWidgetPrefs = { order: ["budget", "goals"], hidden: [] };

describe("CustomizeDrawer", () => {
  it("renders only the closed trigger pill by default", () => {
    const html = renderToStaticMarkup(createElement(CustomizeDrawer, { initialPrefs: prefs }));
    expect(html).toContain("Customize");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("DashboardHeaderActions", () => {
  it("renders the Customize trigger on the overview view", () => {
    const html = renderToStaticMarkup(
      createElement(DashboardHeaderActions, { activeView: "overview", prefsRaw: {} }),
    );
    expect(html).toContain("Customize");
  });

  it("renders nothing on the monitor/plan/wealth views", () => {
    for (const activeView of ["monitor", "plan", "wealth"] as const) {
      const html = renderToStaticMarkup(
        createElement(DashboardHeaderActions, { activeView, prefsRaw: {} }),
      );
      expect(html).toBe("");
    }
  });
});
