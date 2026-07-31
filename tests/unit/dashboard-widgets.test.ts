import { describe, it, expect } from "vitest";
import {
  DEFAULT_WIDGET_ORDER,
  normalizeWidgetPrefs,
  visibleWidgets,
  WIDGET_KEYS,
  type DashboardWidgetPrefs,
} from "@/lib/dashboard-widgets";

/**
 * `dashboard_prefs` is a free-form JSON column written by the browser, so
 * anything can be in it: a prefs blob from before widgets existed, a key from a
 * future release, or a hand-edited mess. Normalization is the only thing
 * standing between that and a dashboard that renders nothing.
 */

describe("normalizeWidgetPrefs", () => {
  it("returns every widget in default order for empty input", () => {
    const prefs = normalizeWidgetPrefs({});
    expect(prefs.order).toEqual(DEFAULT_WIDGET_ORDER);
    expect(prefs.hidden).toEqual([]);
  });

  it("tolerates null, a non-object, and an array", () => {
    for (const raw of [null, undefined, "nope", 42, []]) {
      expect(normalizeWidgetPrefs(raw).order).toEqual(DEFAULT_WIDGET_ORDER);
    }
  });

  it("keeps a valid custom order", () => {
    const prefs = normalizeWidgetPrefs({
      widgets: { order: ["goals", "budget"], hidden: ["investments"] },
    });
    expect(prefs.order.slice(0, 2)).toEqual(["goals", "budget"]);
    expect(prefs.hidden).toEqual(["investments"]);
  });

  it("appends widgets missing from a stored order, so a new one still appears", () => {
    const prefs = normalizeWidgetPrefs({ widgets: { order: ["goals"] } });
    expect(prefs.order[0]).toBe("goals");
    expect(new Set(prefs.order)).toEqual(new Set(WIDGET_KEYS));
    expect(prefs.order).toHaveLength(WIDGET_KEYS.length);
  });

  it("drops unknown keys instead of rendering a widget that does not exist", () => {
    const prefs = normalizeWidgetPrefs({
      widgets: { order: ["budget", "crypto", 7, null], hidden: ["nonsense"] },
    });
    expect(prefs.order).not.toContain("crypto");
    expect(prefs.order[0]).toBe("budget");
    expect(prefs.hidden).toEqual([]);
  });

  it("de-duplicates a repeated key so a widget cannot render twice", () => {
    const prefs = normalizeWidgetPrefs({
      widgets: { order: ["goals", "goals", "budget", "goals"], hidden: ["budget", "budget"] },
    });
    expect(prefs.order.filter((key) => key === "goals")).toHaveLength(1);
    expect(prefs.hidden).toEqual(["budget"]);
  });

  it("ignores a non-array order or hidden", () => {
    const prefs = normalizeWidgetPrefs({
      widgets: { order: "budget", hidden: { investments: true } },
    });
    expect(prefs.order).toEqual(DEFAULT_WIDGET_ORDER);
    expect(prefs.hidden).toEqual([]);
  });

  it("survives a legacy prefs blob that predates widgets", () => {
    const legacy = {
      hideBreakdowns: true,
      hideBillCalendar: true,
      hideWhatIf: false,
      sidebarCollapsed: true,
    };
    const prefs = normalizeWidgetPrefs(legacy);
    expect(prefs.order).toEqual(DEFAULT_WIDGET_ORDER);
    expect(prefs.hidden).toEqual([]);
  });

  it("carries the one legacy flag that maps cleanly onto a widget", () => {
    // hideRecent hid the recent-activity list, which is exactly what the
    // transactions widget shows, so honouring it preserves the user's choice
    // instead of silently un-hiding something they turned off.
    const prefs = normalizeWidgetPrefs({ hideRecent: true });
    expect(prefs.hidden).toEqual(["transactions"]);
  });

  it("lets an explicit widgets block win over the legacy flag", () => {
    const prefs = normalizeWidgetPrefs({
      hideRecent: true,
      widgets: { order: DEFAULT_WIDGET_ORDER, hidden: [] },
    });
    expect(prefs.hidden).toEqual([]);
  });

  it("never lets hidden contain a key that is not in the order", () => {
    const prefs = normalizeWidgetPrefs({
      widgets: { order: DEFAULT_WIDGET_ORDER, hidden: ["budget"] },
    });
    for (const key of prefs.hidden) expect(prefs.order).toContain(key);
  });

  it("is idempotent", () => {
    const once = normalizeWidgetPrefs({ widgets: { order: ["goals"], hidden: ["budget"] } });
    const twice = normalizeWidgetPrefs({ widgets: once });
    expect(twice).toEqual(once);
  });
});

describe("visibleWidgets", () => {
  it("returns the ordered widgets that are not hidden", () => {
    const prefs: DashboardWidgetPrefs = {
      order: ["goals", "budget", "netWorth"],
      hidden: ["budget"],
    };
    expect(visibleWidgets(prefs)).toEqual(["goals", "netWorth"]);
  });

  it("returns an empty list when everything is hidden", () => {
    expect(
      visibleWidgets({ order: [...WIDGET_KEYS], hidden: [...WIDGET_KEYS] }),
    ).toEqual([]);
  });
});
