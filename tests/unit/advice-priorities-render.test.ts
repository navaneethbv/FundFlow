import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import AdvicePriorities from "@/components/advice/AdvicePriorities";

const TOPICS = [
  { id: "emergency-fund", title: "Build a starter emergency fund" },
  { id: "high-interest-debt", title: "Tackle high-interest debt first" },
  { id: "sinking-funds", title: "Save ahead for known costs" },
];

describe("AdvicePriorities", () => {
  it("renders the prioritized list with keyboard-accessible reorder and remove controls", () => {
    const html = renderToStaticMarkup(
      createElement(AdvicePriorities, {
        topics: TOPICS,
        initialPriorities: ["emergency-fund", "high-interest-debt"],
      }),
    );
    expect(html).toContain("Build a starter emergency fund");
    expect(html).toContain('aria-label="Move Build a starter emergency fund up"');
    expect(html).toContain('aria-label="Remove high-interest debt from prioritized"'.replace("high-interest debt", "Tackle high-interest debt first"));
    // The unprioritized topic offers a Prioritize control.
    expect(html).toContain("Save ahead for known costs");
    expect(html).toContain("Prioritize");
  });

  it("shows an empty state when nothing is prioritized", () => {
    const html = renderToStaticMarkup(
      createElement(AdvicePriorities, { topics: TOPICS, initialPriorities: [] }),
    );
    expect(html).toContain("Nothing prioritized yet");
  });

  it("uses the shared advice writer instead of a duplicate endpoint", () => {
    const source = readFileSync(
      new URL("../../components/advice/AdvicePriorities.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('fetch("/api/advice"');
    expect(source).toContain('kind: "set_priorities"');
    expect(source).not.toContain("/api/advice/priorities");
  });
});
