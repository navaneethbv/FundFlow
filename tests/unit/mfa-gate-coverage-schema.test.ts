import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * FF-02. Every authenticated policy on a user-data table must carry both
 * `private.session_not_revoked()` and `private.mfa_satisfied()`, or a revoked
 * or AAL1 token can still reach that table through a direct PostgREST call.
 *
 * This test replays the migration history in order to work out the *effective*
 * policy set: a policy dropped and recreated later is judged by its last
 * definition, not its first.
 */
const MIGRATION_DIR = "supabase/migrations";

interface PolicyState {
  gated: boolean;
  file: string;
}

function effectivePolicies(): Map<string, PolicyState> {
  const files = readdirSync(MIGRATION_DIR).filter((f) => f.endsWith(".sql")).sort();
  const state = new Map<string, PolicyState>();

  for (const file of files) {
    const sql = readFileSync(`${MIGRATION_DIR}/${file}`, "utf8");

    for (const drop of sql.matchAll(
      /drop\s+policy\s+(?:if\s+exists\s+)?"?([^"\s]+)"?\s+on\s+((?:public|storage)\.[a-z_]+)/gi,
    )) {
      state.delete(`${drop[2]}::${drop[1]}`);
    }

    const create = /create\s+policy\s+"([^"]+)"\s+on\s+((?:public|storage)\.[a-z_]+)/gi;
    let match: RegExpExecArray | null;
    while ((match = create.exec(sql)) !== null) {
      // The policy body runs to the first semicolon outside any parentheses.
      let depth = 0;
      let end = sql.length;
      for (let i = create.lastIndex; i < sql.length; i++) {
        const char = sql[i];
        if (char === "(") depth++;
        else if (char === ")") depth--;
        else if (char === ";" && depth <= 0) {
          end = i;
          break;
        }
      }
      const body = sql.slice(match.index, end);
      state.set(`${match[2]}::${match[1]}`, {
        gated: /mfa_satisfied/.test(body) && /session_not_revoked/.test(body),
        file,
      });
    }
  }
  return state;
}

/**
 * Read before a session can reach AAL2, so gating them would lock an
 * MFA-enrolled user out of their own step-up. The gate migration documents the
 * same three.
 */
const AUTH_BOOTSTRAP_TABLES = new Set([
  "public.profiles",
  "public.user_session_records",
  "public.mfa_backup_codes",
]);

describe("MFA and session gate coverage", () => {
  const policies = effectivePolicies();

  it("gates every table the hardening migration names, including the three FF-02 flagged", () => {
    const gateMigration = readFileSync(
      `${MIGRATION_DIR}/20260905100000_mfa_gate_remaining_user_tables.sql`,
      "utf8",
    );
    for (const table of ["life_events", "credit_card_bills", "account_reconciliations"]) {
      expect(gateMigration).toContain(`'${table}'`);
    }
    expect(gateMigration).toContain("private.session_not_revoked()");
    expect(gateMigration).toContain("private.mfa_satisfied()");
  });

  it("rewrites policies in place rather than restating their predicates", () => {
    const gateMigration = readFileSync(
      `${MIGRATION_DIR}/20260905100000_mfa_gate_remaining_user_tables.sql`,
      "utf8",
    );
    // Preserving pol.qual verbatim is what keeps every existing ownership
    // check intact; a hand-rewritten policy could silently drop one.
    expect(gateMigration).toContain("from pg_policies");
    expect(gateMigration).toContain("alter policy");
    // Idempotent: an already-gated policy is skipped.
    expect(gateMigration).toContain("like '%mfa_satisfied%'");
  });

  it("leaves no ungated authenticated policy outside the auth-bootstrap tables", () => {
    const ungated = [...policies.entries()]
      .filter(([key, value]) => {
        const table = key.split("::")[0];
        return !value.gated && !AUTH_BOOTSTRAP_TABLES.has(table);
      })
      .map(([key]) => key);

    // The gate migration rewrites these at apply time, so the static text of
    // the original migrations still shows them ungated. Only tables the gate
    // migration does not name may appear here.
    const gateMigration = readFileSync(
      `${MIGRATION_DIR}/20260905100000_mfa_gate_remaining_user_tables.sql`,
      "utf8",
    );
    const notCoveredByGate = ungated.filter(
      (key) => !gateMigration.includes(`'${key.split("::")[0].replace("public.", "")}'`),
    );

    expect(notCoveredByGate).toEqual([]);
  });
});
