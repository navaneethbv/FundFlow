import { describe, expect, it } from "vitest";
import { createImportLayout, matchImportProfiles, parseWithImportLayout, normalizeImportLayout, stripImportPreamble } from "@/lib/import-profiles";

const source = 'Date,Description,Amount\n31/01/2026,Cafe,-12.50';
const columns = { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null };
const layout = () => createImportLayout(source, { columns, dateOrder: "dmy", positiveIsIncome: true, skipRows: 0 });

describe("saved import layouts", () => {
  it("preserves explicit date order and Plaid amount sign", () => {
    const config = layout();
    expect(config).not.toBeNull();
    expect(parseWithImportLayout(source, config!).rows).toEqual([
      { date: "2026-01-31", merchant: "Cafe", amount: 12.5, category: null },
    ]);
  });

  it("matches normalized ordered headers, never reordered positional columns", () => {
    const profiles = [{ id: "one", name: "Bank", layout: layout()! }];
    expect(matchImportProfiles(' DATE , Description , AMOUNT\n1/2/2026,Shop,-2', profiles)).toEqual(profiles);
    expect(matchImportProfiles('Amount,Description,Date\n-2,Shop,1/2/2026', profiles)).toEqual([]);
    expect(matchImportProfiles('Date,Merchant,Amount\n1/2/2026,Shop,-2', profiles)).toEqual([]);
  });

  it("returns all matching profiles so ambiguous layouts require user choice", () => {
    const profiles = [
      { id: "a", name: "Debit", layout: layout()! },
      { id: "b", name: "Credit", layout: { ...layout()!, positiveIsIncome: false } },
    ];
    expect(matchImportProfiles(source, profiles)).toEqual(profiles);
  });

  it("handles a preamble and split debit/credit columns without changing their signs", () => {
    const text = 'Exported statement\nDay,Payee,Debit,Credit\n2026-02-01,Shop,7,\n2026-02-02,Refund,,2';
    const config = createImportLayout(text, {
      columns: { date: 0, description: 1, debit: 2, credit: 3, amount: null, category: null },
      dateOrder: "ymd", skipRows: 1, positiveIsIncome: true,
    })!;
    expect(parseWithImportLayout(text, config).rows.map(row => row.amount)).toEqual([7, -2]);
    expect(matchImportProfiles(text, [{ id: "a", name: "Layout", layout: config }])).toHaveLength(1);
  });

  it("preserves quoted commas and embedded newlines", () => {
    const text = 'Date,Description,Amount\n31/01/2026,"Cafe, bakery\nWest",-12.50';
    expect(parseWithImportLayout(text, layout()!).rows[0]?.merchant).toBe("Cafe, bakery\nWest");
  });

  it("does not guess ambiguous dates when saving a layout", () => {
    expect(createImportLayout('Date,Description,Amount\n01/02/2026,Cafe,-1', { columns, positiveIsIncome: true, skipRows: 0 })).toBeNull();
  });

  it("rejects dates that conflict with the saved format rather than trying another order", () => {
    const config = { ...layout()!, dateOrder: "mdy" as const };
    const result = parseWithImportLayout(source, config);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("does not interpret year-last dates as year-first", () => {
    expect(parseWithImportLayout(source, { ...layout()!, dateOrder: "ymd" }).rows).toEqual([]);
  });

  it("rejects invalid layouts and missing headers", () => {
    expect(() => parseWithImportLayout(source, { ...layout()!, columnCount: 0 })).toThrow("Invalid saved");
    expect(() => parseWithImportLayout("", layout()!)).toThrow("header");
    expect(() => stripImportPreamble(source, 21)).toThrow("leading row");
    expect(createImportLayout(source, { columns, skipRows: -1, positiveIsIncome: true })).toBeNull();
    expect(matchImportProfiles(source, [{ id: "bad", name: "Bad", layout: { ...layout()!, columnCount: 0 } }])).toEqual([]);
  });

  it("refuses a changed header before applying stored positions", () => {
    expect(() => parseWithImportLayout('Amount,Description,Date\n1,Shop,2026-01-01', layout()!)).toThrow("header");
  });

  it.each([-1, 21, 0.5, "1"])("rejects invalid preamble count %s", skipRows => {
    expect(normalizeImportLayout({ ...layout()!, skipRows })).toBeNull();
  });

  it.each([null, {}, { dateOrder: "guess" }, { positiveIsIncome: "true" }, { headerSignature: "not-a-hash" }, { columnCount: 0 }, { columns: { ...columns, date: 3 } }])("rejects malformed stored layout %j", patch => {
    expect(normalizeImportLayout(patch === null ? null : Object.keys(patch).length === 0 ? {} : { ...layout()!, ...patch })).toBeNull();
  });

  it("does not save duplicate or empty header labels", () => {
    expect(createImportLayout('Date,Date,Amount\n1/1/2026,Shop,1', { columns, dateOrder: "mdy", positiveIsIncome: true, skipRows: 0 })).toBeNull();
    expect(createImportLayout('', { columns, dateOrder: "mdy", positiveIsIncome: true, skipRows: 0 })).toBeNull();
  });
});
