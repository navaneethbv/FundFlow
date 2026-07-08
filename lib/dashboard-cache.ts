interface CacheRecord<T> {
  value: T;
  expiresAt: number;
}

export function createDashboardCache<T>(ttlMs: number) {
  const records = new Map<string, CacheRecord<T>>();

  function key(userId: string, scope: string) {
    return `${userId}:${scope}`;
  }

  return {
    async get(userId: string, scope: string): Promise<T | null> {
      const record = records.get(key(userId, scope));
      if (!record) return null;
      if (record.expiresAt <= Date.now()) {
        records.delete(key(userId, scope));
        return null;
      }
      return record.value;
    },
    async set(userId: string, scope: string, value: T): Promise<void> {
      records.set(key(userId, scope), {
        value,
        expiresAt: Date.now() + ttlMs,
      });
    },
    invalidateUser(userId: string): void {
      for (const cacheKey of records.keys()) {
        if (cacheKey.startsWith(`${userId}:`)) records.delete(cacheKey);
      }
    },
  };
}
