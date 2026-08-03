import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdviceItem } from "@/lib/advice-content";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import AdviceCard from "@/components/advice/AdviceCard";

function item(overrides: Partial<AdviceItem> = {}): AdviceItem {
  return {
    id: "emergency-fund",
    version: 1,
    category: "save_up",
    title: "Build an emergency fund",
    body: "A cash cushion keeps a surprise expense from becoming debt. Aim for three to six months of essential spending.",
    tasks: [
      { id: "task-1", label: "Open a dedicated savings account" },
      { id: "task-2", label: "Set an automatic transfer" },
    ],
    sources: [{ title: "CFPB", url: "https://www.consumerfinance.gov/", reviewedAt: "2026-01-01" }],
    ...overrides,
  };
}

describe("AdviceCard", () => {
  it("collapses behind a native <details> disclosure, not always-expanded content", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item(),
        done: 0,
        total: 2,
        completedTaskIds: new Set<string>(),
      }),
    );
    expect(html).toContain("<details");
    expect(html).toContain("<summary");
  });

  it("shows a Not started meta line with the task count when nothing is done", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item(),
        done: 0,
        total: 2,
        completedTaskIds: new Set<string>(),
      }),
    );
    expect(html).toContain("Not started");
    expect(html).toContain("2 tasks to complete");
  });

  it("shows an In progress meta line with the remaining count", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item(),
        done: 1,
        total: 2,
        completedTaskIds: new Set(["task-1"]),
      }),
    );
    expect(html).toContain("In progress");
    expect(html).toContain("1 task to complete");
  });

  it("shows Completed when every task is done", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item(),
        done: 2,
        total: 2,
        completedTaskIds: new Set(["task-1", "task-2"]),
      }),
    );
    expect(html).toContain("Completed");
  });

  it("shows the category label and a category icon", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item({ category: "invest" }),
        done: 0,
        total: 2,
        completedTaskIds: new Set<string>(),
      }),
    );
    expect(html).toContain("Invest");
  });

  it("clamps the body description to two lines", () => {
    const html = renderToStaticMarkup(
      createElement(AdviceCard, {
        item: item(),
        done: 0,
        total: 2,
        completedTaskIds: new Set<string>(),
      }),
    );
    expect(html).toContain("line-clamp-2");
  });
});
