import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { USER_DATA_TABLES } from "@/lib/user-data";

/**
 * Schema drift guard for the takeout and backup column lists.
 *
 * `collectUserData` rethrows the first PostgREST error it sees, so a single
 * column that no migration creates takes the whole data takeout and backup down
 * with a 500 rather than degrading. That is exactly how `merchant_rules` shipped
 * broken: every query in this suite is mocked, so no test compared the selected
 * columns against the real schema, and three columns that no migration creates
 * sat in the select list.
 *
 * This reads the committed migrations and asserts that every column a spec
 * actually sends to PostgREST exists: the select list, the restore keys, both
 * order columns, and the scope filter.
 */

/** Columns each scope filters on, mirroring `applySpecScope`. */
const SCOPE_COLUMNS: Record<string, string[]> = {
  user: ["user_id"],
  owner: ["owner_user_id"],
  profile: ["id"],
  shared: ["paid_by", "owed_user_id"],
};

function readMigrationSql(): string {
  return readdirSync("supabase/migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(`supabase/migrations/${file}`, "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");
}

/** Split a `create table` body on commas that are not inside parentheses. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** Table constraints look like columns to a naive parser; skip them. */
const CONSTRAINT_START = /^(primary|unique|check|foreign|constraint|exclude)\b/i;

function buildSchema(sql: string): Map<string, Set<string>> {
  const schema = new Map<string, Set<string>>();
  const columnsOf = (table: string) => {
    const existing = schema.get(table);
    if (existing) return existing;
    const created = new Set<string>();
    schema.set(table, created);
    return created;
  };

  const createTable = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.([a-z_]+)\s*\(/gi;
  let created: RegExpExecArray | null;
  while ((created = createTable.exec(sql))) {
    const table = created[1];
    // Walk to the matching close paren so a nested `check (...)` does not end it.
    let index = createTable.lastIndex;
    let depth = 1;
    while (index < sql.length && depth > 0) {
      if (sql[index] === "(") depth += 1;
      else if (sql[index] === ")") depth -= 1;
      index += 1;
    }
    for (const part of splitTopLevel(sql.slice(createTable.lastIndex, index - 1))) {
      const trimmed = part.trim();
      if (!trimmed || CONSTRAINT_START.test(trimmed)) continue;
      const name = /^([a-z_][a-z0-9_]*)/i.exec(trimmed)?.[1];
      if (name) columnsOf(table).add(name);
    }
  }

  const alterTable = /alter\s+table\s+(?:if\s+exists\s+)?public\.([a-z_]+)([\s\S]*?);/gi;
  let altered: RegExpExecArray | null;
  while ((altered = alterTable.exec(sql))) {
    const [, table, body] = altered;
    const addColumn = /add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
    let added: RegExpExecArray | null;
    while ((added = addColumn.exec(body))) columnsOf(table).add(added[1]);
    const dropColumn = /drop\s+column\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
    let dropped: RegExpExecArray | null;
    while ((dropped = dropColumn.exec(body))) schema.get(table)?.delete(dropped[1]);
  }

  return schema;
}

function splitColumnList(list: string | undefined): string[] {
  return (list ?? "")
    .split(",")
    .map((column) => column.trim())
    .filter(Boolean);
}

describe("user data specs match the applied schema", () => {
  const schema = buildSchema(readMigrationSql());

  it("parses the migrations it is asserting against", () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuous, so pin a table whose shape is stable.
    expect(schema.size).toBeGreaterThan(20);
    expect([...(schema.get("merchant_rules") ?? [])]).toEqual(
      expect.arrayContaining(["id", "user_id", "match_type", "pattern", "category"]),
    );
  });

  it.each(USER_DATA_TABLES.map((spec) => [spec.key, spec] as const))(
    "%s selects only columns that exist",
    (_key, spec) => {
      const known = schema.get(spec.table);
      expect(known, `no migration creates table ${spec.table}`).toBeDefined();

      const referenced = [
        ...splitColumnList(spec.select),
        ...splitColumnList(spec.restoreKeys),
        spec.orderBy ?? "id",
        ...(spec.orderBySecondary === null ? [] : [spec.orderBySecondary ?? "id"]),
        ...(SCOPE_COLUMNS[spec.scope] ?? SCOPE_COLUMNS.shared),
      ];

      const missing = [...new Set(referenced)].filter((column) => !known!.has(column));
      expect(missing, `${spec.table} is queried with columns no migration creates`).toEqual([]);
    },
  );
});
