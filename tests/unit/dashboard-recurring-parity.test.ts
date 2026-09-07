import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecurringWidget from "@/components/dashboard/widgets/RecurringWidget";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getDashboardData } from "@/lib/dashboard";
import { loadRecurringData } from "@/lib/recurring-data";

const stream = {
  id: "stream-1", user_id: "u1", account_id: "a1", plaid_item_id: "bank-1",
  merchant_name: "Utility", description: null, stream_type: "outflow",
  average_amount: 90, user_amount: 25, last_amount: 90,
  frequency: "MONTHLY", is_active: true, status: "MATURE", dismissed_at: null,
  predicted_next_date: "2026-09-05", first_date: "2026-08-05", last_date: "2026-08-05",
  category: "RENT_AND_UTILITIES",
};
const manual = { id: "manual-1", user_id: "u1", name: "Piano lessons", amount: 40,
  frequency: "weekly", next_date: "2026-09-05", item_type: "expense", enabled: true };
const account = { id: "a1", user_id: "u1", name: "Checking", type: "depository",
  current_balance: 1000, plaid_item_id: "bank-1" };

type Row = Record<string, unknown>;
function client(tables: Record<string, Row[]>, errors: Record<string, string> = {}): SupabaseClient {
  return { from(table: string) {
    let rows = tables[table] ?? [];
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.eq = (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return chain; };
    chain.in = (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return chain; };
    chain.gte = (key: string, value: string) => { rows = rows.filter(row => String(row[key]) >= value); return chain; };
    chain.lt = (key: string, value: string) => { rows = rows.filter(row => String(row[key]) < value); return chain; };
    chain.range = (from: number, to: number) => { rows = rows.slice(from, to + 1); return chain; };
    chain.limit = (n: number) => { rows = rows.slice(0, n); return chain; };
    const result = () => ({data: rows, error: errors[table] ? {code: errors[table]} : null});
    chain.maybeSingle = () => Promise.resolve({...result(), data: rows[0] ?? null});
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  }} as unknown as SupabaseClient;
}
const base = { recurring_streams: [stream], manual_recurring_items: [manual], accounts: [account] };
async function dashboard(tables = base, options: {account?: string; today?: string} = {}) {
  return getDashboardData(client(tables), options.account, "2026-09", "u1", {today: options.today ?? "2026-09-06"});
}

describe("Dashboard uses Recurring's persisted occurrences", () => {
  it("honors corrected amounts, enabled manual items, and month expansion", async () => {
    const data = await dashboard();
    const recurring = await loadRecurringData(client(base), {userId:"u1", anchorMonth:"2026-09", today:"2026-09-06"});
    expect(data.subscriptions.find(row => row.merchant === "Utility")?.amount).toBe(25);
    expect(data.recurringStatuses.map(row => [row.name, row.amount, row.nextDate])).toEqual(
      recurring.view.occurrences.map(row => [row.merchant, row.amount, row.dueDate]),
    );
    expect(data.recurringStatuses.filter(row => row.name === "Piano lessons")).toHaveLength(4);
  });

  it("does not infer payment from a same-name transaction without a stream link", async () => {
    const data = await dashboard({...base, transactions: [{id:"t1", user_id:"u1", account_id:"a1", date:"2026-09-05", merchant_name:"Utility", name:"Utility", amount:25,pfc_primary:"RENT_AND_UTILITIES",pfc_detailed:null}]} as typeof base);
    expect(data.recurringStatuses.find(row => row.name === "Utility")?.status).toBe("late");
  });

  it("uses a linked payment at most once across streams", async () => {
    const data = await dashboard({...base, recurring_streams:[stream, {...stream,id:"stream-2"}],
      transactions:[{id:"t1", user_id:"u1", account_id:"a1", date:"2026-09-05", amount:25,pfc_primary:"RENT_AND_UTILITIES",pfc_detailed:null}],
      recurring_stream_transactions:[{user_id:"u1",recurring_stream_id:"stream-1",transaction_id:"t1"},{user_id:"u1",recurring_stream_id:"stream-2",transaction_id:"t1"}],
    } as typeof base);
    expect(data.recurringStatuses.filter(row => row.status === "paid")).toHaveLength(1);
  });

  it("keeps an account filter exact and omits unassigned manual items", async () => {
    const data = await dashboard({...base, recurring_streams:[stream,{...stream,id:"other",account_id:"a2"}]}, {account:"a1"});
    expect(data.recurringStatuses).toHaveLength(1);
  });

  it("rejects an unavailable recurring input query", async () => {
    await expect(getDashboardData(client(base,{manual_recurring_items:"42501"}),undefined,"2026-09","u1")).rejects.toThrow("manual_recurring_items");
  });
  it.each([
    {account_id:"a2",user_id:"u1",amount:25},
    {account_id:"a1",user_id:"u2",amount:25},
    {account_id:"a1",user_id:"u1",amount:-25},
    {account_id:"a1",user_id:"u1",amount:0},
  ])("never marks paid using an invalid persisted link: %j", async (transaction) => {
    const data = await dashboard({...base,
      transactions:[{id:"t1",date:"2026-09-05",pfc_primary:"RENT_AND_UTILITIES",pfc_detailed:null,...transaction}],
      recurring_stream_transactions:[{user_id:"u1",recurring_stream_id:"stream-1",transaction_id:"t1"}],
    } as typeof base);
    expect(data.recurringStatuses.find(row => row.name === "Utility")?.status).toBe("late");
  });

  it("renders the corrected amount and manual reminder through the actual Dashboard widget", async () => {
    const data = await dashboard();
    const html = renderToStaticMarkup(createElement(RecurringWidget, {
      items:data.recurringStatuses,today:"2026-09-06",currency:"USD",
    }));
    expect(html).toContain("$25.00");
    expect(html).not.toContain("$90.00");
    expect(html).toContain("Piano lessons");
    expect(html).toContain("Late");
  });

});
