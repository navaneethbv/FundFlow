import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createImportLayout } from "@/lib/import-profiles";
import { prepareImportProfile } from "@/lib/import-profile-preview";
const flags = vi.hoisted(() => ({ enabled: false }));
vi.mock("@/lib/feature-flags", () => ({ isFeatureEnabled: () => flags.enabled }));
const text = 'Date,Description,Amount\n31/01/2026,Cafe,-12.50';
const columns = { date: 0, description: 1, amount: 2, debit: null, credit: null, category: null };
const layout = createImportLayout(text, { columns, dateOrder: "dmy", positiveIsIncome: true, skipRows: 0 })!;
function client(data: unknown[] | null = [], error: unknown = null) {
  const query = { select: vi.fn(() => query), eq: vi.fn(() => query), limit: vi.fn().mockResolvedValue({ data, error }) };
  const from = vi.fn(() => query);
  return { db: { from } as unknown as SupabaseClient, from, query };
}
function form(values: Record<string, string> = {}) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}
beforeEach(() => { flags.enabled = true; });
describe("import profile preparation", () => {
  it("does not read the new schema when disabled", async () => {
    flags.enabled = false;
    const db = client();
    expect(await prepareImportProfile(db.db, "owner", text, form())).toEqual({ text });
    expect(db.from).not.toHaveBeenCalled();
  });
  it.each(["profile_id", "skip_rows"])("refuses the disabled %s entry point", async field => {
    flags.enabled = false;
    const db = client();
    expect((await prepareImportProfile(db.db, "owner", text, form({ [field]: "0" }))).response?.status).toBe(404);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("auto-selects only one valid owner-scoped match", async () => {
    const db = client([{ id: "a", name: "Bank", layout }, { id: "invalid", layout: {} }]);
    const result = await prepareImportProfile(db.db, "owner", text, form());
    expect(result.profile).toEqual({ id: "a", name: "Bank" });
    expect(result.layout).toEqual(layout);
    expect(db.query.eq).toHaveBeenCalledWith("user_id", "owner");
  });
  it("requires a choice between identical headers with different conventions", async () => {
    const db = client([{ id: "a", name: "Deposits", layout }, { id: "b", name: "Charges", layout: { ...layout, positiveIsIncome: false } }]);
    const result = await prepareImportProfile(db.db, "owner", text, form());
    expect(await result.response?.json()).toEqual({ needs_profile_choice: true, profiles: [{ id: "a", name: "Deposits" }, { id: "b", name: "Charges" }] });
    expect((await prepareImportProfile(db.db, "owner", text, form({ profile_id: "b" }))).layout?.positiveIsIncome).toBe(false);
  });
  it("refuses a foreign or mismatched profile instead of falling back", async () => {
    expect((await prepareImportProfile(client().db, "owner", text, form({ profile_id: "foreign" }))).response?.status).toBe(400);
  });
  it.each(["-1", "21", "1.5", "bad"])("rejects invalid leading rows %s", async skip_rows => {
    expect((await prepareImportProfile(client().db, "owner", text, form({ skip_rows }))).response?.status).toBe(400);
  });
  it("rejects a file as profile identifier", async () => {
    const input = form(); input.set("profile_id", new File(["bad"], "id"));
    expect((await prepareImportProfile(client().db, "owner", text, input)).response?.status).toBe(400);
  });
  it("propagates a read error", async () => {
    await expect(prepareImportProfile(client([], new Error("offline")).db, "owner", text, form())).rejects.toThrow("offline");
  });
  it("snapshots manually selected columns and skipped rows without consulting saved profiles", async () => {
    const db = client();
    const result = await prepareImportProfile(db.db, "owner", `Bank export\n${text}`, form({ skip_rows: "1", date_order: "dmy", column_map: JSON.stringify(columns), positive_is_income: "false" }));
    expect(result.layout).toMatchObject({ skipRows: 1, dateOrder: "dmy", positiveIsIncome: false, columns });
    expect(db.from).not.toHaveBeenCalled();
  });
  it("supports manually configured detectable columns", async () => {
    const db = client();
    expect((await prepareImportProfile(db.db, "owner", text, form({ profile_id: "manual", date_order: "dmy" }))).layout).toEqual(layout);
    expect(db.from).not.toHaveBeenCalled();
  });
  it("does not create a saveable snapshot with automatic dates or missing headers", async () => {
    expect((await prepareImportProfile(client(null).db, "owner", text, form())).layout).toBeUndefined();
    expect((await prepareImportProfile(client().db, "owner", "", form())).layout).toBeUndefined();
  });
  it("reports malformed mapping JSON", async () => {
    expect((await prepareImportProfile(client().db, "owner", text, form({ column_map: "{" }))).response?.status).toBe(400);
  });
  it.each([
    '<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>',
    'Date,Description,Original Description,Amount,Transaction Type,Category,Account Name,Labels,Notes\n01/31/2026,Cafe,Cafe,12,debit,Food,Bank,,',
  ])("leaves dedicated format importers in control", async source => {
    const db = client();
    expect(await prepareImportProfile(db.db, "owner", source, form({ date_order: "mdy" }))).toEqual({ text: source });
    expect(db.from).not.toHaveBeenCalled();
  });
});
