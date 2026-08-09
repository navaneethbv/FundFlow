import { NextRequest, NextResponse } from "next/server";
import { badRequest, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";

const ACTIONS = new Set(["register", "rename", "delete"]);

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  if (!body || !ACTIONS.has(body.action)) return badRequest("Invalid passkey action");
  if (typeof body.passkeyId !== "string" || !body.passkeyId) {
    return badRequest("Invalid passkeyId");
  }

  await writeAudit({
    userId: auth.user.id,
    action: `passkey_${body.action}` as "passkey_register" | "passkey_rename" | "passkey_delete",
    metadata: { passkeyId: body.passkeyId },
    ip: getClientIp(request),
  });
  return NextResponse.json({ success: true });
}
