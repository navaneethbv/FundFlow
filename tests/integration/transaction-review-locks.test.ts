import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Explicit opt-in to a throwaway local PostgreSQL database. This suite does
// not read .env.local credentials and never connects to a hosted project.
const target = process.env.TEST_TRANSACTION_REVIEW_DATABASE_URL;
const parsed = target ? new URL(target) : null;
if (parsed && !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)) {
  throw new Error("Transaction review lock tests require a loopback throwaway database");
}
const run = promisify(execFile);
const psql = process.env.PSQL_BIN ?? "psql";
const owner = randomUUID();
const account = randomUUID();
function query(sql: string, name = "review-lock-test") {
  return run(psql, [target!, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", sql], { env: { ...process.env, PGAPPNAME: name } }).then((r) => r.stdout.trim());
}
function review(id: string, status = "reviewed", version = "1") {
  return `select public.set_transaction_review_state_atomic('${owner}','${status}','[{"transaction_id":"${id}","expected_version":"${version}"}]');`;
}
async function transaction() {
  const id = randomUUID();
  await query(`insert into transactions(id,user_id,manual_account_id,plaid_transaction_id,date,amount,name,source,pending) values('${id}','${owner}','${account}','lock-${id}','2026-09-01',10,'Lock test','manual',false)`);
  return id;
}
async function waitForHolder(name: string) {
  for (let i = 0; i < 100; i++) {
    if (await query(`select count(*) from pg_stat_activity where application_name='${name}' and wait_event='PgSleep'`) === "1") return;
    await delay(10);
  }
  throw new Error("Holder never reached its lock barrier");
}
describe.skipIf(!target)("transaction review real row-lock interleavings", () => {
  beforeAll(async () => {
    await query(`insert into auth.users(id,email) values('${owner}','review-lock-${owner}@example.com'); insert into manual_accounts(id,user_id,name,account_type,balance) values('${account}','${owner}','Lock test','cash',100)`);
  });
  afterAll(async () => { await query(`delete from auth.users where id='${owner}'`); });

  it("rejects an opposing action waiting behind a committed review", async () => {
    const id = await transaction();
    const name = `review-${id}`;
    const holder = query(`begin; ${review(id)} select pg_sleep(1); commit;`, name);
    await waitForHolder(name);
    await expect(query(review(id, "needs_review"))).rejects.toMatchObject({ stderr: expect.stringContaining("REVIEW_STATE_CHANGED") });
    await holder;
    expect(await query(`select status||':'||version from transaction_review_states where transaction_id='${id}'`)).toBe("reviewed:2");
  });
  it("rejects review waiting behind a source-fact update and keeps the reopened state", async () => {
    const id = await transaction();
    await query(review(id));
    const name = `sync-${id}`;
    const holder = query(`begin; update transactions set amount=20 where id='${id}'; select pg_sleep(1); commit;`, name);
    await waitForHolder(name);
    await expect(query(review(id, "reviewed", "2"))).rejects.toMatchObject({ stderr: expect.stringContaining("REVIEW_STATE_CHANGED") });
    await holder;
    expect(await query(`select status||':'||version from transaction_review_states where transaction_id='${id}'`)).toBe("needs_review:3");
  });
  it("aborts the entire review batch after a concurrent duplicate exclusion", async () => {
    const kept = await transaction(); const excluded = await transaction();
    const name = `duplicate-${excluded}`;
    const holder = query(`begin; select id from transactions where id in ('${kept}','${excluded}') order by id for update; insert into linked_duplicates(user_id,subject_id,kept_transaction_id,excluded_transaction_id) values('${owner}','${kept}:${excluded}','${kept}','${excluded}'); select pg_sleep(1); commit;`, name);
    await waitForHolder(name);
    await expect(query(`select set_transaction_review_state_atomic('${owner}','reviewed','[{"transaction_id":"${kept}","expected_version":"1"},{"transaction_id":"${excluded}","expected_version":"1"}]')`)).rejects.toMatchObject({ stderr: expect.stringContaining("REVIEW_STATE_CHANGED") });
    await holder;
    expect(await query(`select count(*) from transaction_review_states where transaction_id in ('${kept}','${excluded}') and status='needs_review' and version=1`)).toBe("2");
  });
});
