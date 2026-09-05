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

function detectOs(ua: string): string {
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/Linux/i.test(ua)) return "Linux";
  return "";
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return "Edge";
  if (/Chrome\//i.test(ua) && !/Chromium|Edg\//i.test(ua)) return "Chrome";
  if (/Safari\//i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) return "Safari";
  if (/Firefox\//i.test(ua)) return "Firefox";
  return "";
}

export function formatDeviceLabel(ua: string | null): string {
  if (!ua || ua.trim() === "") return "Unknown device";
  if (!ua.includes("Mozilla/") && !ua.includes(";")) return ua.trim();

  const os = detectOs(ua);
  const browser = detectBrowser(ua);

  if (browser && os) return `${browser} on ${os}`;
  return browser || os || ua.slice(0, 40);
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
