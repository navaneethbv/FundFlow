/**
 * The dashboard widget registry and its preference schema.
 *
 * Preferences live in `profiles.dashboard_prefs`, a client-writable JSON column
 * that predates widgets and is shared with the sidebar-collapse flag and the
 * old hide-a-section toggles. Phase 8 adds a `widgets` key alongside them
 * rather than taking the column over, so no migration is needed and nothing
 * else that writes the column is disturbed.
 *
 * Everything here is pure. `normalizeWidgetPrefs` is deliberately total: it
 * takes `unknown` and always returns a usable layout, because the alternative
 * is a dashboard that renders nothing when the column holds something
 * unexpected.
 */

export const WIDGET_KEYS = [
  "budget",
  "spendingCompare",
  "netWorth",
  "transactions",
  "recurring",
  "goals",
  "investments",
] as const;

export type WidgetKey = (typeof WIDGET_KEYS)[number];

export interface DashboardWidgetPrefs {
  order: WidgetKey[];
  hidden: WidgetKey[];
}

export const DEFAULT_WIDGET_ORDER: WidgetKey[] = [...WIDGET_KEYS];

const KEY_SET = new Set<string>(WIDGET_KEYS);

/**
 * Legacy hide-flags that map one-to-one onto a widget. Only `hideRecent`
 * qualifies: it hid the recent-activity list, which is exactly what the
 * transactions widget shows. The others (`hideBreakdowns`, `hideBillCalendar`,
 * `hideWhatIf`, `hideDebt`) hid parts of the Monitor and Plan views that have
 * no single widget equivalent, so translating them would be guessing at intent.
 * Those views still exist and still honour their own flags.
 */
const LEGACY_WIDGET_FLAGS: Record<string, WidgetKey> = {
  hideRecent: "transactions",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Valid widget keys from an unknown array, in order, without duplicates. */
function widgetKeyList(value: unknown): WidgetKey[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<WidgetKey>();
  for (const entry of value) {
    if (typeof entry === "string" && KEY_SET.has(entry)) {
      seen.add(entry as WidgetKey);
    }
  }
  return [...seen];
}

export function normalizeWidgetPrefs(raw: unknown): DashboardWidgetPrefs {
  const root = isRecord(raw) ? raw : {};
  const widgets = isRecord(root.widgets) ? root.widgets : null;

  const storedOrder = widgets ? widgetKeyList(widgets.order) : null;
  // Any widget missing from a stored order is appended rather than dropped, so
  // a release that adds a widget shows it instead of hiding it from everyone
  // who ever saved a layout.
  const order: WidgetKey[] = storedOrder
    ? [...storedOrder, ...DEFAULT_WIDGET_ORDER.filter((key) => !storedOrder.includes(key))]
    : [...DEFAULT_WIDGET_ORDER];

  let hidden = widgets ? widgetKeyList(widgets.hidden) : null;
  if (!widgets) {
    // No widgets block at all: fall back to the legacy flags so a user who
    // turned something off before Phase 8 does not find it switched back on.
    const legacy = Object.entries(LEGACY_WIDGET_FLAGS)
      .filter(([flag]) => root[flag] === true)
      .map(([, key]) => key);
    hidden = legacy.length > 0 ? legacy : [];
  }

  return { order, hidden: hidden ?? [] };
}

/** The widgets to render, in order. */
export function visibleWidgets(prefs: DashboardWidgetPrefs): WidgetKey[] {
  const hidden = new Set(prefs.hidden);
  return prefs.order.filter((key) => !hidden.has(key));
}

export interface WidgetDefinition {
  key: WidgetKey;
  label: string;
  /** One line explaining what the widget shows, used by the customize drawer. */
  hint: string;
  /** Widgets that read a whole-page-width chart get the full column span. */
  wide: boolean;
}

export const WIDGET_DEFINITIONS: Record<WidgetKey, WidgetDefinition> = {
  budget: {
    key: "budget",
    label: "Budget",
    hint: "Planned against actual for this month",
    wide: false,
  },
  spendingCompare: {
    key: "spendingCompare",
    label: "Spending vs last month",
    hint: "Cumulative spend, day by day",
    wide: true,
  },
  netWorth: {
    key: "netWorth",
    label: "Net worth",
    hint: "Assets minus liabilities over time",
    wide: false,
  },
  transactions: {
    key: "transactions",
    label: "Recent transactions",
    hint: "The latest activity across accounts",
    wide: false,
  },
  recurring: {
    key: "recurring",
    label: "Recurring",
    hint: "What is due in the next seven days",
    wide: false,
  },
  goals: {
    key: "goals",
    label: "Goals",
    hint: "Progress toward each target",
    wide: false,
  },
  investments: {
    key: "investments",
    label: "Investments",
    hint: "Holdings and allocation",
    wide: false,
  },
};

/**
 * Merge a widget layout back into the wider prefs object without disturbing the
 * sibling keys (`sidebarCollapsed`, the legacy hide flags, hidden account ids).
 * The column has several independent writers, so a blind overwrite would
 * silently discard whichever one wrote last.
 */
export function mergeWidgetPrefs(
  existing: unknown,
  widgets: DashboardWidgetPrefs,
): Record<string, unknown> {
  return { ...(isRecord(existing) ? existing : {}), widgets };
}
