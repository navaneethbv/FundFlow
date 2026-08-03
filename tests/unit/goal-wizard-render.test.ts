import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

import GoalWizard from "@/components/goals/GoalWizard";

/**
 * `GoalWizard`'s open state is a full-screen overlay behind internal
 * `useState`, not a prop — like `CustomizeDrawer`/`SeedBudgetButton`
 * elsewhere in this app, there is no jsdom here to click it open, so the
 * open-state shell is verified via source assertions and the closed
 * trigger via a real render.
 */
describe("GoalWizard — closed trigger", () => {
  it("renders the Add goal trigger button", () => {
    const html = renderToStaticMarkup(
      createElement(GoalWizard, { accounts: [], defaultGoalType: "save_up" }),
    );
    expect(html).toContain("Add goal");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("GoalWizard — full-screen overlay shell", () => {
  const source = readFileSync("components/goals/GoalWizard.tsx", "utf8");

  it("is a fixed full-viewport overlay, not an inline card", () => {
    expect(source).toContain("fixed inset-0 z-50");
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
  });

  it("has a back arrow that steps back, and a separate close control", () => {
    expect(source).toContain("draft.step > 1 ? () => patch({ step: draft.step - 1 }) : cancel");
    expect(source).toContain('aria-label="Close"');
    expect(source).toContain("onClick={cancel}");
  });

  it("renders the four step titles as a centered stepper", () => {
    expect(source).toContain("STEP_TITLES.map((title, index) =>");
    expect(source).toContain('aria-current={index === draft.step - 1 ? "step" : undefined}');
  });

  it("has a thin progress bar sized to the current step", () => {
    expect(source).toContain("(draft.step / STEP_TITLES.length) * 100");
  });

  it("offers Skip only on the Contribution step (step 3)", () => {
    expect(source).toContain("draft.step === 3 &&");
    expect(source).toContain("Skip");
  });

  it("centers the footer's Continue/Create action", () => {
    expect(source).toContain("mx-auto flex w-full max-w-2xl justify-center gap-3");
  });
});
