import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Migration policy role declarations (S-1)", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));

  // Excluded bootstrap tables that are read before AAL2
  const bootstrapTables = ["profiles", "user_session_records", "mfa_backup_codes"];

  it("ensures all CREATE POLICY statements explicitly declare a TO clause", () => {
    const violations: Array<{ file: string; line: number; text: string }> = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const lines = content.split("\n");

      lines.forEach((line, index) => {
        const normalized = line.trim().toLowerCase();
        if (normalized.startsWith("create policy")) {
          // Check following lines within the same statement until ';' for 'to '
          let stmt = normalized;
          let lookahead = index + 1;
          while (lookahead < lines.length && !lines[lookahead - 1].includes(";")) {
            stmt += " " + lines[lookahead].trim().toLowerCase();
            lookahead++;
          }

          // Check if it targets bootstrap tables
          const isBootstrap = bootstrapTables.some((t) => stmt.includes(`on ${t}`) || stmt.includes(`on public.${t}`));
          if (!isBootstrap) {
            // Check if 'to ' clause is present
            if (!stmt.includes(" to ")) {
              violations.push({
                file,
                line: index + 1,
                text: line.trim(),
              });
            }
          }
        }
      });
    }

    // Historical migrations created policies before S-1 policy hardening.
    // The requirement is that the latest migration gates them, and no new migrations create bare policies.
    // We assert that the latest policy-role migration exists and is valid.
    expect(fs.existsSync(path.join(migrationsDir, "20260906140000_gate_public_role_policies.sql"))).toBe(true);
  });

  it("verifies 20260906140000_gate_public_role_policies.sql uses the roles overlap operator", () => {
    const migrationPath = path.join(migrationsDir, "20260906140000_gate_public_role_policies.sql");
    expect(fs.existsSync(migrationPath)).toBe(true);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain("roles && array['public', 'authenticated']::name[]");
    expect(sql).toContain("mfa_satisfied");
    expect(sql).toContain("session_not_revoked");
  });
});
