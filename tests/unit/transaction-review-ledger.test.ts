import { describe, expect, it } from "vitest";
import {
  hasActiveLedgerFilters,
  ledgerHref,
  ledgerQueryEntries,
  parseLedgerQuery,
  savedLedgerViewParams,
} from "@/lib/ledger-query";

describe("ledger-query transaction review integration", () => {
  it("defaults review to 'all'", () => {
    const state = parseLedgerQuery({});
    expect(state.review).toBe("all");
    expect(hasActiveLedgerFilters(state)).toBe(false);
    expect(ledgerQueryEntries(state).some(([k]) => k === "review")).toBe(false);
  });

  it("parses valid review parameter values", () => {
    const needsReview = parseLedgerQuery({ review: "needs_review" });
    expect(needsReview.review).toBe("needs_review");
    expect(hasActiveLedgerFilters(needsReview)).toBe(true);
    expect(ledgerQueryEntries(needsReview)).toContainEqual(["review", "needs_review"]);

    const reviewed = parseLedgerQuery({ review: "reviewed" });
    expect(reviewed.review).toBe("reviewed");
    expect(hasActiveLedgerFilters(reviewed)).toBe(true);
    expect(ledgerQueryEntries(reviewed)).toContainEqual(["review", "reviewed"]);

    const all = parseLedgerQuery({ review: "all" });
    expect(all.review).toBe("all");
    expect(hasActiveLedgerFilters(all)).toBe(false);
  });

  it("falls back to 'all' for invalid review values", () => {
    const invalid1 = parseLedgerQuery({ review: "invalid_status" });
    expect(invalid1.review).toBe("all");

    const invalid2 = parseLedgerQuery({ review: "pending" });
    expect(invalid2.review).toBe("all");

    const invalid3 = parseLedgerQuery({ review: ["invalid1", "invalid2"] });
    expect(invalid3.review).toBe("all");
  });

  it("persists review in savedLedgerViewParams when filtered", () => {
    const state = parseLedgerQuery({ review: "needs_review", q: "coffee" });
    expect(savedLedgerViewParams(state)).toEqual({
      review: "needs_review",
      q: "coffee",
    });

    const stateAll = parseLedgerQuery({ review: "all", q: "coffee" });
    expect(savedLedgerViewParams(stateAll)).toEqual({
      q: "coffee",
    });
  });

  it("supports updating and clearing review via ledgerHref", () => {
    const initial = parseLedgerQuery({ review: "needs_review", page: "2" });
    const hrefReviewed = ledgerHref(ledgerQueryEntries(initial), { review: "reviewed" });
    const urlReviewed = new URL(hrefReviewed, "https://fundflow.test");
    expect(urlReviewed.searchParams.get("review")).toBe("reviewed");
    expect(urlReviewed.searchParams.get("page")).toBeNull();

    const hrefCleared = ledgerHref(ledgerQueryEntries(initial), { review: null });
    const urlCleared = new URL(hrefCleared, "https://fundflow.test");
    expect(urlCleared.searchParams.get("review")).toBeNull();

    const hrefEmpty = ledgerHref(ledgerQueryEntries(initial), { review: "" });
    const urlEmpty = new URL(hrefEmpty, "https://fundflow.test");
    expect(urlEmpty.searchParams.get("review")).toBeNull();
  });
});
