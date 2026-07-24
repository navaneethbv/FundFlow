/**
 * Pure OFX/QFX statement parsing ("download for Quicken" files) for the
 * Settings import flow. Emits the same normalized shape as lib/import.ts
 * CSV parsing so the rest of the import pipeline is format-agnostic.
 *
 * Handles both SGML-style OFX 1.x (field values end at the newline, no
 * closing tags) and XML-style OFX 2.x (proper closing tags). QFX is OFX
 * with a Quicken header. Malformed blocks are skipped, never thrown on.
 *
 * Sign convention: OFX debits carry a negative TRNAMT; FundFlow follows
 * Plaid where positive = money out. Amounts are therefore negated.
 */

export interface OfxTransaction {
  date: string;
  description: string;
  amount: number;
  fitid: string | null;
}

/** Cheap sniff so route wiring can pick the OFX path over CSV. */
export function looksLikeOfx(content: string): boolean {
  const head = content.slice(0, 2000);
  return /OFXHEADER/i.test(head) || /<OFX>/i.test(head);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

/**
 * Reads one tag's value inside a STMTTRN block. The value runs until the
 * next "<" or end of line — this single rule covers both SGML (newline
 * terminated) and XML (closing-tag terminated) variants.
 */
function field(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}>([^<\\r\\n]*)`, "i"));
  const value = match?.[1]?.trim();
  return value ? decodeEntities(value) : null;
}

/** First 8 chars of DTPOSTED → YYYY-MM-DD, or null when implausible. */
function parseOfxDate(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

export function parseOfx(content: string): OfxTransaction[] {
  const rows: OfxTransaction[] = [];
  const blocks = content.matchAll(
    /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi,
  );

  for (const match of blocks) {
    const block = match[1] ?? "";
    const date = parseOfxDate(field(block, "DTPOSTED"));
    const amountRaw = field(block, "TRNAMT");
    const ofxAmount = amountRaw === null ? Number.NaN : Number(amountRaw);
    if (!date || !Number.isFinite(ofxAmount)) continue;

    const name = field(block, "NAME");
    const memo = field(block, "MEMO");
    const description =
      name && memo
        ? name === memo
          ? name
          : `${name} — ${memo}`
        : (name ?? memo ?? "");

    rows.push({
      date,
      description,
      amount: Math.round(-ofxAmount * 100) / 100,
      fitid: field(block, "FITID"),
    });
  }

  return rows;
}
