const SECRET_KEY_RE = /(token|secret|ciphertext|iv|tag|password|key)$/i;

export function redactTakeoutSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => redactTakeoutSecrets(item)) as T;
  }
  if (!value || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !SECRET_KEY_RE.test(key))
    .map(([key, item]) => [key, redactTakeoutSecrets(item)]);

  return Object.fromEntries(entries) as T;
}

export function buildDataTakeout(sections: Record<string, unknown[]>) {
  return redactTakeoutSecrets(sections);
}

export function buildAuditLogPage(
  rows: { userId: string | null; action: string; metadata: Record<string, unknown> }[],
  userId: string,
  limit: number,
) {
  const visible = rows
    .filter((row) => row.userId === userId)
    .slice(0, limit)
    .map((row) => ({
      action: row.action,
      metadata: Object.fromEntries(
        Object.entries(row.metadata).map(([key, value]) => [
          key,
          key.toLowerCase().includes("ip") ? "[redacted]" : value,
        ]),
      ),
    }));

  return {
    rows: visible,
    nextCursor: rows.filter((row) => row.userId === userId).length > limit ? String(limit) : null,
  };
}

export function formatDeviceLabel(ua: string | null): string {
  if (!ua || ua.trim() === "") return "Unknown device";
  if (!ua.includes("Mozilla/") && !ua.includes(";")) {
    return ua.trim();
  }
  let os = "";
  if (/Macintosh|Mac OS X/i.test(ua)) os = "Mac";
  else if (/iPhone/i.test(ua)) os = "iPhone";
  else if (/iPad/i.test(ua)) os = "iPad";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Linux/i.test(ua)) os = "Linux";

  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Chromium|Edg\//i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) browser = "Safari";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";

  if (browser && os) return `${browser} on ${os}`;
  if (browser) return browser;
  if (os) return os;
  return ua.slice(0, 40);
}

export function buildSessionList(
  sessions: { id: string; current: boolean; userAgent: string | null; lastSeenAt: string }[],
) {
  return [...sessions]
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
    .map((session) => ({
      id: session.id,
      label: formatDeviceLabel(session.userAgent),
      current: session.current,
    }));
}
