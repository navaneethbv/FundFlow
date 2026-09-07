import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Recent sync jobs panel selected `source`, a column no migration creates.
 * The query failed, the page rendered `data ?? []`, and an admin saw an empty
 * panel next to a nonzero sync-job count - a failure disguised as "nothing
 * happened" on the page whose whole job is showing failures.
 */
vi.mock("@/components/shell/AppShell", () => ({
  default: ({ children }: { children: React.ReactNode }) =>
    createElement("div", { "data-testid": "app-shell" }, children),
}));
vi.mock("@/components/shell/PageHeader", () => ({
  default: ({ title }: { title: string }) => createElement("header", null, title),
}));

const selectedColumns: string[] = [];
let serviceRows: Record<string, unknown[]> = {};
let serviceErrors: Record<string, unknown> = {};

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  let columns = "";
  chain.select = (cols: string) => {
    columns = cols;
    selectedColumns.push(`${table}:${cols}`);
    return chain;
  };
  for (const method of ["eq", "order", "limit", "gte", "lt", "is"]) {
    chain[method] = () => chain;
  }
  const key = () => `${table}:${columns}`;
  const payload = () => ({
    data: serviceErrors[key()] ? null : serviceRows[key()] ?? [],
    error: serviceErrors[key()] ?? null,
    count: (serviceRows[key()] ?? []).length,
  });
  chain.maybeSingle = () => {
    const result = payload();
    return Promise.resolve({
      data: Array.isArray(result.data) ? result.data[0] ?? null : result.data,
      error: result.error,
    });
  };
  chain.single = chain.maybeSingle;
  chain.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(payload()).then(resolve);
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@b.c" } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { role: "admin" }, error: null }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({ from: (table: string) => chainFor(table) }),
}));

const { default: AdminObservabilityPage } = await import("@/app/admin/page");

const RECENT_JOBS_KEY = "sync_jobs:id, status, job_type, updated_at";

async function render(): Promise<string> {
  const element = await AdminObservabilityPage();
  return renderToStaticMarkup(element);
}

function syncJobsPanel(html: string): string {
  return html.slice(html.indexOf("Recent sync jobs"), html.indexOf("Bank health"));
}

describe("admin recent sync jobs panel", () => {
  beforeEach(() => {
    selectedColumns.length = 0;
    serviceRows = {};
    serviceErrors = {};
  });

  it("selects a column the schema actually has, never `source`", async () => {
    await render();

    expect(selectedColumns).toContain(RECENT_JOBS_KEY);
    expect(selectedColumns.some((entry) => entry.includes("source"))).toBe(false);
  });

  it("reports a failed query instead of rendering an empty panel", async () => {
    serviceErrors[RECENT_JOBS_KEY] = { message: 'column sync_jobs.source does not exist' };

    const panel = syncJobsPanel(await render());
    expect(panel).toContain("Could not load this panel.");
    expect(panel).toContain("does not exist");
    expect(panel).not.toContain("No sync jobs recorded yet.");
  });

  it("distinguishes a genuine no-jobs state from a failure", async () => {
    serviceRows[RECENT_JOBS_KEY] = [];

    const panel = syncJobsPanel(await render());
    expect(panel).toContain("No sync jobs recorded yet.");
    expect(panel).not.toContain("Could not load this panel.");
  });

  it("marks a failed job as a failure and formats its timestamp", async () => {
    serviceRows[RECENT_JOBS_KEY] = [
      { id: "j1", status: "failed", job_type: "transactions", updated_at: "2026-09-05T09:00:00Z" },
    ];

    const panel = syncJobsPanel(await render());
    expect(panel).toContain("failed");
    expect(panel).toContain("bg-danger");
    expect(panel).toContain("Sep 5, 2026");
    expect(panel).not.toContain("2026-09-05T09:00:00Z");
  });

  it("keeps a done job on the success tone", async () => {
    serviceRows[RECENT_JOBS_KEY] = [
      { id: "j1", status: "done", job_type: "investments", updated_at: "2026-09-05T09:00:00Z" },
    ];

    const panel = syncJobsPanel(await render());
    expect(panel).toContain("investments");
    expect(panel).toContain("bg-success");
    expect(panel).not.toContain("bg-danger");
  });
});
