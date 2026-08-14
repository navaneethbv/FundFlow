import "server-only";
import type { NextRequest } from "next/server";
import { getClientIp, writeAudit, type AuditAction } from "@/lib/audit";

type RequestAuditWriter = (
  request: NextRequest,
  userId: string,
  metadata: Record<string, unknown>,
) => Promise<void>;

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

function createRequestAuditWriters<const T extends Record<string, AuditAction>>(
  actions: T,
): Record<keyof T, RequestAuditWriter> {
  return Object.fromEntries(
    Object.entries(actions).map(([name, action]) => [
      name,
      (request: NextRequest, userId: string, metadata: Record<string, unknown>) =>
        writeRequestAudit(request, userId, action, metadata),
    ]),
  ) as Record<keyof T, RequestAuditWriter>;
}

export const requestAudits = createRequestAuditWriters({
  apiTokenCreated: "api_token_created",
  apiTokenRevoked: "api_token_revoked",
  calendarTokenCreated: "calendar_token_created",
  calendarTokenRevoked: "calendar_token_revoked",
  goalContributionRecorded: "goal_contribution_recorded",
  goalContributionRemoved: "goal_contribution_removed",
  savedReportCreated: "saved_report_created",
  savedReportUpdated: "saved_report_updated",
  savedReportDeleted: "saved_report_deleted",
});
