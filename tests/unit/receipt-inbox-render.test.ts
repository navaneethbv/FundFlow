import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ReceiptInbox from "@/components/transactions/ReceiptInbox";

describe("ReceiptInbox", () => {
  it("orders unmatched receipts first and renders every state action", () => {
    const html = renderToStaticMarkup(createElement(ReceiptInbox, {
      initialReceipts: [
        {
          id: "ignored-1",
          transaction_id: null,
          merchant: "Old store",
          purchase_date: "2026-08-01",
          total: 10,
          status: "ignored",
          created_at: "2026-08-01T12:00:00Z",
          imageUrl: "https://signed.example/old",
          candidates: [],
        },
        {
          id: "unmatched-1",
          transaction_id: null,
          merchant: "Cafe",
          purchase_date: "2026-08-09",
          total: 24.5,
          status: "unmatched",
          created_at: "2026-08-09T12:00:00Z",
          imageUrl: "https://signed.example/new",
          candidates: [{
            transactionId: "transaction-1",
            date: "2026-08-09",
            amount: 24.5,
            merchant: "Cafe",
            amountDifferencePercent: 0,
            dateDifferenceDays: 0,
            merchantScore: 1,
          }],
        },
      ],
    }));

    expect(html.indexOf("Cafe")).toBeLessThan(html.indexOf("Old store"));
    expect(html).toContain("Open image");
    expect(html).toContain("Attach");
    expect(html).toContain("Ignore");
    expect(html).toContain("Restore");
    expect(html).toContain("Delete");
  });

  it("renders an upload path and honest empty state", () => {
    const html = renderToStaticMarkup(createElement(ReceiptInbox, { initialReceipts: [] }));

    expect(html).toContain("Upload receipt");
    expect(html).toContain("No saved receipts");
  });

  it("links the ledger and AI scanner to the persistent inbox", () => {
    const transactions = readFileSync("app/transactions/page.tsx", "utf8");
    const scanner = readFileSync("components/settings/ReceiptScanSection.tsx", "utf8");

    expect(transactions).toContain('href="/transactions/receipts"');
    expect(scanner).toContain("Save to receipt inbox");
    expect(scanner).toContain('fetch("/api/receipts"');
  });

  it("sets receipt dates in the mono face and wraps totals in the privacy-blur hook", () => {
    const html = renderToStaticMarkup(createElement(ReceiptInbox, {
      initialReceipts: [
        {
          id: "unmatched-1",
          transaction_id: null,
          merchant: "Cafe",
          purchase_date: "2026-08-09",
          total: 24.5,
          status: "unmatched",
          created_at: "2026-08-09T12:00:00Z",
          imageUrl: "https://signed.example/new",
          candidates: [{
            transactionId: "transaction-1",
            date: "2026-08-09",
            amount: 24.5,
            merchant: "Cafe",
            amountDifferencePercent: 0,
            dateDifferenceDays: 0,
            merchantScore: 1,
          }],
        },
      ],
    }));

    expect(html).toContain('<span class="font-mono">2026-08-09</span>');
    // react-dom/server serializes a bare boolean attribute as data-money="true".
    expect(html).toContain('<span data-money="true">$24.50</span>');
  });
});
