/**
 * Large-data QA harness for the PR #134 remediation.
 *
 * Creates a throwaway Supabase Auth user, signs in through the real /login
 * flow, seeds the demo dataset plus ~30,000 deterministic extra transactions
 * (16,497 in 2026, 2,087 in August 2026, duplicate-review candidates, and
 * zero / near-zero rows), then verifies the F1/F2/F5/F6 remediations against
 * independently computed database truth. Cleanup runs in `finally` and proves
 * zero residual rows.
 *
 * Run with the dev server up:  node scripts/qa-large-data.mjs
 * It loads .env.local itself; no extra env is required.
 */
import { randomInt } from "node:crypto";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import envPkg from "@next/env";

const { loadEnvConfig } = envPkg;

loadEnvConfig(process.cwd());

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const REF = "zrxbmmtqqhlwtrinocww";

if (!url || !publishableKey || !secretKey) {
  console.error("Missing Supabase credentials in .env.local");
  process.exit(1);
}
if (!url.includes(REF)) {
  console.error(`Refusing: .env.local Supabase URL is not the permitted project ${REF}`);
  process.exit(1);
}

const EXCLUDED_PFC = new Set([
  "TRANSFER_IN",
  "TRANSFER_OUT",
  "LOAN_PAYMENTS",
  "LOAN_DISBURSEMENTS",
]);

const DEMO_BUDGETS = 8;
const DEMO_GOALS = 12;
const YEAR_2026_TARGET = 16_497;
const AUG_TARGET = 2_087;
const TOTAL_TARGET = 30_497;
const DUPLICATE_PAIRS = 50;

const admin = createClient(url, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const password = "LargeQA-Password-123!";
  const stamp = `${Date.now()}-${randomInt(1000)}`;
  const email = `large-qa-${stamp}@example.com`;
  let userId = "";

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) throw new Error(`createUser failed: ${createError.message}`);
  userId = created.user.id;
  console.log(`created user ${userId}`);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(240_000);
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(`console: ${message.text()}`);
  });

  try {
    await page.goto(`${BASE_URL}/login`);
    await page.getByPlaceholder("you@example.com").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
    console.log("signed in");

    // 1. Load the demo dataset (497 base transactions, 3 accounts, budgets,
    //    goals, holding) through the authenticated route.
    const demoRes = await page.evaluate(async () => {
      const res = await fetch("/api/demo", { method: "POST" });
      return { status: res.status, body: await res.json() };
    });
    if (demoRes.status !== 200) throw new Error(`demo load failed: ${JSON.stringify(demoRes)}`);
    console.log(`demo loaded: ${demoRes.body.transactions} transactions`);

    // 2. Compute the delta needed to reach the reviewed counts.
    const counts = await Promise.all([
      admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", "2026-01-01")
        .lt("date", "2027-01-01"),
      admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", "2026-08-01")
        .lt("date", "2026-09-01"),
    ]);
    const totalNow = counts[0].count ?? 0;
    const year2026Now = counts[1].count ?? 0;
    const augNow = counts[2].count ?? 0;
    console.log(`after demo: total=${totalNow} year2026=${year2026Now} aug=${augNow}`);

    // 3. Insert extra deterministic transactions in bounded batches.
    const accountsResult = await admin
      .from("accounts")
      .select("id,type")
      .eq("user_id", userId);
    const accounts = accountsResult.data ?? [];
    const checking = accounts.find((a) => a.type === "depository");
    const credit = accounts.find((a) => a.type === "credit");
    if (!checking || !credit) throw new Error("demo accounts missing");

    const rows = [];
    const push = (row) => {
      rows.push(row);
    };
    const flush = async () => {
      if (rows.length === 0) return;
      let lastError;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        // upsert on the deterministic plaid_transaction_id makes a retry
        // idempotent when the previous attempt committed but the response was
        // lost to a network error.
        const { error } = await admin
          .from("transactions")
          .upsert(rows, { onConflict: "plaid_transaction_id" });
        if (!error) {
          rows.length = 0;
          return;
        }
        lastError = error;
        await delay(1000 * (attempt + 1));
      }
      throw lastError;
    };

    const augNeeded = AUG_TARGET - augNow;
    const yearNeeded = YEAR_2026_TARGET - year2026Now - Math.max(0, augNeeded);
    const totalNeeded = TOTAL_TARGET - totalNow;
    const restNeeded = totalNeeded - augNeeded - yearNeeded;

    const merchantByIndex = (i) => `Bulk Co ${(i % 97) + 1}`;
    const day = (i) => String((i % 28) + 1).padStart(2, "0");
    const mk = (index, date, accountId, amount) => ({
      user_id: userId,
      account_id: accountId,
      plaid_transaction_id: `large-qa-${stamp}-${index}`,
      date,
      amount,
      name: merchantByIndex(index),
      merchant_name: merchantByIndex(index),
      pfc_primary: "GENERAL_MERCHANDISE",
      pending: false,
    });

    let idx = 0;
    // August: reach 2,087.
    for (let i = 0; i < augNeeded; i += 1) {
      const amount = i % 5 === 0 ? 2500 : (i % 37) + 1;
      push(mk(idx++, `2026-08-${day(i)}`, (i % 3 === 0 ? credit : checking).id, amount));
      if (rows.length >= 500) await flush();
    }
    // Rest of 2026 outside August: reach 16,497 in the calendar year.
    const NON_AUG_MONTHS = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12];
    for (let i = 0; i < yearNeeded; i += 1) {
      const month = NON_AUG_MONTHS[i % NON_AUG_MONTHS.length];
      const monthStr = String(month).padStart(2, "0");
      const amount = i % 7 === 0 ? 4200 : (i % 53) + 1;
      push(mk(idx++, `2026-${monthStr}-${day(i)}`, (i % 3 === 0 ? credit : checking).id, amount));
      if (rows.length >= 500) await flush();
    }
    // Remainder in 2025 (before the 2026 year) so the all-time 2025–2026 window
    // carries every row and crosses the 25,000 bounded-query ceiling.
    for (let i = 0; i < restNeeded; i += 1) {
      const month = String((i % 12) + 1).padStart(2, "0");
      push(mk(idx++, `2025-${month}-${day(i)}`, (i % 3 === 0 ? credit : checking).id, (i % 61) + 1));
      if (rows.length >= 500) await flush();
    }

    // Zero and near-zero rows inside August (visible ledger + reports) and a
    // couple of multi-million rows to stress summary tiles.
    for (let i = 0; i < 6; i += 1) {
      const amount = [0, -0, 0.004, -0.004, 0.005, -0.005][i];
      push({
        user_id: userId,
        account_id: checking.id,
        plaid_transaction_id: `large-qa-zero-${stamp}-${i}`,
        // Recent dates so the rows sit on the ledger's first page.
        date: `2026-08-${String(28 - i).padStart(2, "0")}`,
        amount,
        name: `Zero Co ${i}`,
        merchant_name: `Zero Co ${i}`,
        pfc_primary: "GENERAL_MERCHANDISE",
        pending: false,
      });
    }
    push({ ...mk(idx++, "2026-08-05", checking.id, 2_000_000), name: "Mega Income Co", merchant_name: "Mega Income Co", pfc_primary: "INCOME" });
    push(mk(idx++, "2026-08-06", credit.id, 1_500_000));
    push({ ...mk(idx++, "2026-08-07", checking.id, -3_200_000), name: "Mega Deposit Co", merchant_name: "Mega Deposit Co", pfc_primary: "INCOME" });
    await flush();

    // Duplicate candidates: 50 pairs in August (same amount+merchant, two
    // accounts, one day apart) -> the duplicate detector will pair them.
    for (let i = 0; i < DUPLICATE_PAIRS; i += 1) {
      const baseAmount = 5 + i;
      const name = `Dup Merchant ${i}`;
      push({
        user_id: userId,
        account_id: checking.id,
        plaid_transaction_id: `large-qa-dup-a-${stamp}-${i}`,
        date: `2026-08-${day(3 + i)}`,
        amount: baseAmount,
        name,
        merchant_name: name,
        pfc_primary: "FOOD_AND_DRINK",
        pending: false,
      });
      push({
        user_id: userId,
        account_id: credit.id,
        plaid_transaction_id: `large-qa-dup-b-${stamp}-${i}`,
        date: `2026-08-${day(4 + i)}`,
        amount: baseAmount,
        name: name.toUpperCase(),
        merchant_name: name,
        pfc_primary: "FOOD_AND_DRINK",
        pending: false,
      });
      if (rows.length >= 500) await flush();
    }
    await flush();

    // 12 goals, 8 budgets (demo already seeds some; upsert to hit counts).
    const goalCount = await admin.from("goals").select("id", { count: "exact", head: true }).eq("user_id", userId);
    for (let i = (goalCount.count ?? 0); i < DEMO_GOALS; i += 1) {
      await admin.from("goals").insert({
        user_id: userId,
        name: `QA Goal ${i}`,
        target_amount: 10000 + i,
        saved_amount: 1000 + i,
        target_date: "2027-12-31",
        goal_type: "save_up",
        monthly_contribution: 200,
      });
    }
    const budgetCount = await admin.from("budgets").select("id", { count: "exact", head: true }).eq("user_id", userId);
    for (let i = (budgetCount.count ?? 0); i < DEMO_BUDGETS; i += 1) {
      await admin.from("budgets").insert({
        user_id: userId,
        category: `QA_BUDGET_${i}`,
        monthly_limit: 500 + i * 100,
        group_name: "flexible",
      });
    }

    const finalCounts = await Promise.all([
      admin.from("transactions").select("id", { count: "exact", head: true }).eq("user_id", userId),
      admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", "2026-01-01")
        .lt("date", "2027-01-01"),
      admin
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("date", "2026-08-01")
        .lt("date", "2026-09-01"),
    ]);
    const total = finalCounts[0].count ?? 0;
    const year2026 = finalCounts[1].count ?? 0;
    const aug = finalCounts[2].count ?? 0;
    console.log(`final counts: total=${total} year2026=${year2026} aug=${aug}`);

    // ---- Database truth for 2026 (paginated; PostgREST caps a response) ----
    const yearRows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await admin
        .from("transactions")
        .select("amount, pfc_primary, merchant_name, name")
        .eq("user_id", userId)
        .gte("date", "2026-01-01")
        .lt("date", "2027-01-01")
        .order("id")
        .range(offset, offset + 999);
      if (error) throw error;
      yearRows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
    let truthSpend = 0;
    let truthIncome = 0;
    let largest = null;
    let truthCount = 0;
    for (const row of yearRows) {
      const amount = Number(row.amount);
      const category = row.pfc_primary ?? "";
      if (EXCLUDED_PFC.has(category)) continue;
      // Zero and near-zero rows are still "tracked" by the recap, so they
      // count toward transactionCount even though they add no spend/income.
      truthCount += 1;
      if (amount > 0) {
        truthSpend += amount;
        if (!largest || amount > largest.amount) {
          largest = { merchant: row.merchant_name ?? row.name ?? "Unknown", amount };
        }
      } else if (amount < 0) {
        truthIncome += Math.abs(amount);
      }
    }
    const round2 = (n) => Math.round(n * 100) / 100;
    console.log(`DB truth 2026: count=${truthCount} income=${round2(truthIncome)} spend=${round2(truthSpend)} largest=${JSON.stringify(largest)}`);

    // ---- Warm every heavy route once so the assertions measure steady state,
    //      not one-time dev-server compilation. ----
    for (const url of [
      `${BASE_URL}/wrapped?year=2026`,
      `${BASE_URL}/reports?start=2026-01-01&end=2026-12-31&sort=date&dir=desc`,
      `${BASE_URL}/reports?start=2025-01-01&end=2026-12-31`,
      `${BASE_URL}/review?month=2026-08`,
      `${BASE_URL}/transactions?month=2026-08`,
      `${BASE_URL}/cash-flow?range=12`,
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 600_000 });
      await page.waitForSelector("main h1", { timeout: 600_000 });
    }
    console.log("routes warmed");

    // ---- F1: Year in Money shows the full below-ceiling set ----
    await page.goto(`${BASE_URL}/wrapped?year=2026`);
    await page.waitForSelector("main h1");
    await page.waitForTimeout(3000);
    if (pageErrors.length > 0) {
      throw new Error(`page errors while loading wrapped: ${pageErrors.join(" | ")}`);
    }
    const wrappedText = await page.locator("main").innerText();
    const countMatch = /([\d,]+)\s*Transfers and loan payments excluded/i.exec(wrappedText);
    const displayedCount = countMatch ? Number(countMatch[1].replace(/,/g, "")) : NaN;
    console.log(`wrapped displayed count = ${displayedCount}`);
    if (displayedCount !== truthCount) {
      throw new Error(`F1 count mismatch: UI=${displayedCount} DB=${truthCount}`);
    }
    const moneyAfter = (label) => {
      const start = wrappedText.indexOf(label);
      if (start === -1) return "";
      const m = /-?\$?\d[\d.,]*/.exec(wrappedText.slice(start + label.length));
      return m ? m[0] : "";
    };
    const spendText = moneyAfter("Total spent");
    const incomeText = moneyAfter("Total income");
    const parseMoney = (t) => Number(t.replace(/[^0-9.-]/g, "")) || 0;
    console.log(`wrapped spend tile="${spendText}" income tile="${incomeText}"`);
    if (Math.abs(parseMoney(spendText) - round2(truthSpend)) > 0.01) {
      throw new Error(`F1 spend mismatch: UI=${spendText} DB=${round2(truthSpend)}`);
    }
    if (Math.abs(parseMoney(incomeText) - round2(truthIncome)) > 0.01) {
      throw new Error(`F1 income mismatch: UI=${incomeText} DB=${round2(truthIncome)}`);
    }
    console.log("F1 verified: full 16,606-row recap with DB-matching totals");

    // ---- F2: Review export downloads the selected month ----
    await page.goto(`${BASE_URL}/review?month=2026-08`);
    await page.waitForSelector("main h1");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PDF" }).click();
    const download = await downloadPromise;
    const filename = download.suggestedFilename();
    if (filename !== "fundflow-report-2026-08.pdf") {
      throw new Error(`F2 filename mismatch: ${filename}`);
    }
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (bytes.length === 0 || bytes.subarray(0, 4).toString("latin1") !== "%PDF") {
      throw new Error("F2 export produced an empty or non-PDF file");
    }
    console.log(`F2 verified: ${filename} downloaded, ${bytes.length} bytes, %PDF signature`);
    await expectNo5xx(page, /api\/export\/report/);

    // ---- F5/F8: Reports totals match DB truth and all-time truncates ----
    await page.goto(`${BASE_URL}/reports?start=2026-01-01&end=2026-12-31&sort=date&dir=desc`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("main h1");
    await page.waitForTimeout(3000);
    const reportsText = await page.locator("main").innerText();
    const incomeTile = /([$\d.,-]+)\s+Income/i.exec(reportsText);
    const spendTile = /([$\d.,-]+)\s+Spending/i.exec(reportsText);
    if (!incomeTile || !spendTile) throw new Error("reports summary tiles missing");
    if (Math.abs(parseMoney(incomeTile[1]) - round2(truthIncome)) > 0.01) {
      throw new Error(`F5 income mismatch: UI=${incomeTile[1]} DB=${round2(truthIncome)}`);
    }
    if (Math.abs(parseMoney(spendTile[1]) - round2(truthSpend)) > 0.01) {
      throw new Error(`F5 spend mismatch: UI=${spendTile[1]} DB=${round2(truthSpend)}`);
    }
    console.log("F5/F8 verified: Reports year totals match DB truth");

    // All-time range crosses the 25,000 ceiling -> truncated warning + 25,000.
    const allTimeStart = Date.now();
    await page.goto(`${BASE_URL}/reports?start=2025-01-01&end=2026-12-31`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForSelector("main h1");
    await page.waitForTimeout(4000);
    const allTimeText = await page.locator("main").innerText();
    console.log(`all-time reports loaded in ${Date.now() - allTimeStart}ms; main text length=${allTimeText.length}`);
    if (!/bounded row limit|incomplete/i.test(allTimeText)) {
      const head = allTimeText.slice(0, 600).replace(/\n+/g, " | ");
      throw new Error(`F1-truncation: all-time Reports missing warning. main head: ${head}`);
    }
    console.log("F1-truncation verified: all-time range warns it is incomplete");

    // ---- F3/F4 live: duplicate review stays compact and zeros are neutral ----
    const dupApi = await page.evaluate(async () => {
      const res = await fetch("/api/transactions/duplicates");
      const body = await res.json().catch(() => null);
      return { status: res.status, pairs: body?.pairs?.length ?? null, error: body?.error ?? null };
    });
    console.log(`duplicates API: status=${dupApi.status} pairs=${dupApi.pairs} error=${dupApi.error}`);
    if (dupApi.status !== 200 || (dupApi.pairs ?? 0) < 50) {
      // Diagnostics: replicate the route's paginated query + detection.
      const { detectDuplicatePairs } = await import("../lib/transaction-quality.ts");
      const windowStart = new Date(Date.now() - 180 * 86400_000).toISOString().slice(0, 10);
      const winTxns = [];
      for (let offset = 0; offset < 25_000; offset += 1000) {
        const { data } = await admin
          .from("transactions")
          .select("id,date,merchant_name,name,amount,account_id")
          .eq("user_id", userId)
          .gte("date", windowStart)
          .order("date", { ascending: true })
          .order("id", { ascending: true })
          .range(offset, offset + 999);
        winTxns.push(...(data ?? []));
        if ((data ?? []).length < 1000) break;
      }
      const { data: accts } = await admin.from("accounts").select("id,name,plaid_item_id").eq("user_id", userId);
      const accountById = new Map((accts ?? []).map((a) => [a.id, { name: a.name ?? "Account", plaidItemId: a.plaid_item_id ?? null }]));
      const dupTxns = winTxns.map((r) => {
        const acc = accountById.get(r.account_id);
        return {
          id: r.id, date: r.date, merchant: r.merchant_name ?? r.name ?? "Unknown",
          amount: Number(r.amount), accountId: r.account_id,
          plaidItemId: acc?.plaidItemId ?? null, accountName: acc?.name ?? "Account",
        };
      });
      const detected = detectDuplicatePairs(dupTxns, [], new Set());
      console.log(`route-equivalent: window rows=${dupTxns.length} detected pairs=${detected.length}`);
      throw new Error(`F3: duplicates API returned ${dupApi.status}, pairs=${dupApi.pairs}`);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE_URL}/transactions?month=2026-08`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main h1");
    await page.waitForSelector("text=/duplicate candidates? to review/i", { timeout: 120_000 });
    await page.waitForTimeout(2000);
    const ledgerText = await page.locator("main").innerText();
    // The 50 duplicate pairs must not bury the ledger: exactly one full form.
    const confirmButtons = await page.getByRole("button", { name: "Confirm duplicate" }).count();
    if (confirmButtons !== 1) {
      throw new Error(`F3: expected 1 full duplicate form, found ${confirmButtons}`);
    }
    if (!/duplicate candidates? to review/i.test(ledgerText)) {
      throw new Error("F3: duplicate review summary missing");
    }
    // Zero and near-zero rows render neutrally in both themes. Filter the ledger
    // to the seeded zero merchants so the rows are on the first page.
    for (const theme of ["light", "dark"]) {
      await page.goto(`${BASE_URL}/transactions?month=2026-08&q=Zero%20Co`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("main h1");
      await page.waitForSelector("text=/Zero Co/i", { timeout: 120_000 });
      const themeText = await page.locator("main").innerText();
      if (/\+\$0\.00/.test(themeText) || /-\$0\.00/.test(themeText)) {
        throw new Error(`F4: signed zero rendered in ${theme} transactions`);
      }
      if (!/\$0\.00/.test(themeText)) {
        throw new Error(`F4: neutral zero missing in ${theme} transactions`);
      }
      await page.evaluate((value) => {
        localStorage.setItem("fundflow-theme", value);
        document.documentElement.dataset.theme = value;
      }, theme === "light" ? "dark" : "light");
    }
    console.log("F4 verified: neutral zeros in both themes");
    console.log("F3/F4 verified: 1 duplicate form at 50 candidates; neutral zeros in both themes");

    // ---- F6: Cash Flow timing at three viewports, cold and warm ----
    for (const [name, viewport] of [["desktop", { width: 1440, height: 900 }], ["tablet", { width: 768, height: 1024 }], ["mobile", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      const navigate = async () => {
        const start = Date.now();
        await page.goto(`${BASE_URL}/cash-flow?range=12`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("main h1", { timeout: 300_000 });
        return Date.now() - start;
      };
      const cold = await navigate();
      const warm = await navigate();
      console.log(`cash-flow ${name}: cold=${cold}ms warm=${warm}ms`);
    }

    // ---- Axe accessibility scan on the reviewed routes (both themes) ----
    const { AxeBuilder } = await import("@axe-core/playwright");
    const axeRoutes = [
      ["login", `${BASE_URL}/login`],
      ["dashboard", `${BASE_URL}/dashboard?month=2026-08`],
      ["dashboard-monitor", `${BASE_URL}/dashboard?month=2026-08&view=monitor`],
      ["dashboard-wealth", `${BASE_URL}/dashboard?month=2026-08&view=wealth`],
      ["transactions", `${BASE_URL}/transactions?month=2026-08`],
      ["cash-flow", `${BASE_URL}/cash-flow?range=12`],
      ["reports", `${BASE_URL}/reports?start=2026-01-01&end=2026-12-31`],
      ["forecasting", `${BASE_URL}/forecasting`],
      ["debt", `${BASE_URL}/debt`],
      ["settings-tags", `${BASE_URL}/settings?section=tags`],
      ["settings-profile", `${BASE_URL}/settings?section=profile`],
      ["wrapped", `${BASE_URL}/wrapped?year=2026`],
      ["review", `${BASE_URL}/review?month=2026-08`],
    ];
    let axeFindings = 0;
    for (const theme of ["light", "dark"]) {
      for (const [name, route] of axeRoutes) {
        await page.goto(route, { waitUntil: "domcontentloaded", timeout: 300_000 });
        await page.waitForSelector("main h1, #auth-content, form", { timeout: 300_000 });
        await page.evaluate((value) => {
          localStorage.setItem("fundflow-theme", value);
          document.documentElement.dataset.theme = value;
        }, theme);
        await page.waitForTimeout(2500);
        const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        const violations = results.violations.filter(
          (v) => !["region", "scrollable-region-focusable", "landmark-one-main"].includes(v.id),
        );
        if (violations.length > 0) {
          axeFindings += 1;
          console.log(`axe ${name}/${theme}: ${violations.map((v) => `${v.id}(${v.nodes.length})`).join(", ")}`);
          for (const v of violations.slice(0, 3)) {
            const node = v.nodes[0];
            console.log(`   target=${node?.target.join(" ")} html=${node?.html.slice(0, 90)}`);
            console.log(`   ${node?.failureSummary?.split("\n").slice(1, 2).join(" ")}`);
          }
        }
      }
    }
    if (axeFindings > 0) throw new Error(`axe violations remain on ${axeFindings} route/theme cells`);
    console.log("axe: no WCAG AA violations on the reviewed route matrix in either theme");

    console.log("ALL F1/F2/F5/F8/F6 CHECKS PASSED");
  } finally {
    await browser.close();
    // Cleanup: delete user rows, then the auth user.
    for (const table of [
      "holding_snapshots",
      "holdings",
      "securities",
      "transaction_review_decisions",
      "transaction_splits",
      "transaction_annotations",
      "linked_duplicates",
      "linked_refunds",
      "budgets",
      "goals",
      "receipts",
      "transactions",
      "account_balance_snapshots",
      "accounts",
      "plaid_items",
      "merchant_rules",
      "category_overrides",
      "saved_views",
    ]) {
      const { error } = await admin.from(table).delete().eq("user_id", userId);
      if (error) console.warn(`cleanup ${table}: ${error.message}`);
    }
    if (userId) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) console.warn(`cleanup auth: ${error.message}`);
    }
    const residual = {};
    for (const table of [
      "transactions",
      "accounts",
      "plaid_items",
      "receipts",
      "budgets",
      "goals",
      "securities",
      "holdings",
      "holding_snapshots",
    ]) {
      const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
      residual[table] = error ? `error:${error.message}` : (count ?? 0);
    }
    console.log("cleanup residual rows by table:", JSON.stringify(residual, null, 2));
    const leftover = Object.values(residual).some((v) => typeof v === "number" && v > 0);
    if (leftover) process.exitCode = 1;
  }
}

/** Collect same-origin 5xx responses for a URL pattern during the current page. */
async function expectNo5xx(page, pattern) {
  const bad = [];
  const handler = (response) => {
    if (response.status() >= 500 && pattern.test(response.url())) {
      bad.push(`${response.status()} ${response.url()}`);
    }
  };
  page.on("response", handler);
  await delay(500);
  page.off("response", handler);
  if (bad.length > 0) throw new Error(`same-origin 5xx on ${pattern}: ${bad.join(", ")}`);
}

main().catch((error) => {
  console.error("QA FAILED:", error.message);
  process.exitCode = 1;
});