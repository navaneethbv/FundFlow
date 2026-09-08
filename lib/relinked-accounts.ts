/**
 * Fields Plaid keeps stable enough to compare two complete Item snapshots.
 * A single account is never matched heuristically: last-four collisions and
 * generic names are both common enough that doing so could hide real money.
 */
export interface RelinkedAccountIdentity {
  id: string;
  user_id?: string | null;
  plaid_item_id: string;
  name?: string | null;
  mask?: string | null;
  type?: string | null;
  subtype?: string | null;
  iso_currency_code?: string | null;
  updated_at?: string | null;
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function accountFingerprint(account: RelinkedAccountIdentity): string | null {
  const name = normalized(account.name);
  const mask = account.mask?.trim() ?? "";
  if (!name || !mask) return null;
  return JSON.stringify([
    name,
    mask,
    normalized(account.type),
    normalized(account.subtype),
    normalized(account.iso_currency_code),
  ]);
}

interface ItemSnapshot<T> {
  itemId: string;
  rows: T[];
  signature: string | null;
  freshness: number | null;
}

function itemSnapshot<T extends RelinkedAccountIdentity>(
  itemId: string,
  rows: T[],
): ItemSnapshot<T> {
  const fingerprints = rows.map(accountFingerprint);
  const uniqueFingerprints = new Set(fingerprints);
  const owners = new Set(rows.map((row) => row.user_id ?? ""));
  const timestamps = rows.map((row) => Date.parse(row.updated_at ?? ""));
  const validTimestamps = timestamps.filter(Number.isFinite);
  const isSafeCompleteSet =
    rows.length >= 2 &&
    owners.size === 1 &&
    !fingerprints.includes(null) &&
    uniqueFingerprints.size === rows.length;

  return {
    itemId,
    rows,
    signature: isSafeCompleteSet
      ? JSON.stringify([[...owners][0], [...uniqueFingerprints].sort()])
      : null,
    freshness:
      validTimestamps.length === rows.length
        ? Math.max(...validTimestamps)
        : null,
  };
}

/**
 * Suppress an accidental duplicate Plaid Item only when both Items expose the
 * same complete, unambiguous account set and one set is uniquely fresher.
 * Rows stay untouched in storage, preserving history and user configuration.
 */
export function dedupeRelinkedAccounts<T extends RelinkedAccountIdentity>(
  accounts: readonly T[],
): T[] {
  const rowsByItem = new Map<string, T[]>();
  for (const account of accounts) {
    const itemRows = rowsByItem.get(account.plaid_item_id) ?? [];
    itemRows.push(account);
    rowsByItem.set(account.plaid_item_id, itemRows);
  }

  const snapshots = [...rowsByItem].map(([itemId, rows]) =>
    itemSnapshot(itemId, rows),
  );
  const snapshotsBySignature = new Map<string, ItemSnapshot<T>[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.signature) continue;
    const matches = snapshotsBySignature.get(snapshot.signature) ?? [];
    matches.push(snapshot);
    snapshotsBySignature.set(snapshot.signature, matches);
  }

  const suppressedItemIds = new Set<string>();
  for (const matches of snapshotsBySignature.values()) {
    if (matches.length < 2) continue;
    const ranked = matches
      .filter((snapshot) => snapshot.freshness !== null)
      .sort((a, b) => (b.freshness ?? 0) - (a.freshness ?? 0));
    if (
      ranked.length !== matches.length ||
      ranked[0]?.freshness === ranked[1]?.freshness
    ) {
      continue;
    }
    for (const duplicate of ranked.slice(1)) {
      suppressedItemIds.add(duplicate.itemId);
    }
  }

  return accounts.filter(
    (account) => !suppressedItemIds.has(account.plaid_item_id),
  );
}
