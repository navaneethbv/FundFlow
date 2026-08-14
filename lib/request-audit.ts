import "server-only";
import type { NextRequest } from "next/server";
import { getClientIp, writeAudit, type AuditAction } from "@/lib/audit";

export function writeRequestAudit(
  request: NextRequest,
  userId: string,
  action: AuditAction,
  metadata: Record<string, unknown>,
): Promise<void> {
  return writeAudit({
    userId,
    action,
    metadata,
    ip: getClientIp(request),
  });
}
