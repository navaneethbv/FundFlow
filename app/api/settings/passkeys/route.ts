import { NextRequest, NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { getClientIp, writeAudit } from "@/lib/audit";
import { createServiceClient } from "@/lib/supabase/service";

const ACTIONS = new Set(["register", "rename", "delete"]);

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  const body = await request.json().catch(() => null);
  if (!body || !ACTIONS.has(body.action)) return badRequest("Invalid passkey action");
  if (typeof body.passkeyId !== "string" || !body.passkeyId) {
    return badRequest("Invalid passkeyId");
  }

  try {
    const service = createServiceClient();

    // Registration and rename are WebAuthn ceremonies that only the browser
    // can perform, so the client runs them first. The server verifies the
    // passkey actually exists for this user before acknowledging anything, so
    // the UI can never report success for a passkey that is not there.
    const { data: passkeys } = await service.auth.admin.passkey.listPasskeys({
      userId: auth.user.id,
    });
    if (!(passkeys ?? []).some((passkey) => passkey.id === body.passkeyId)) {
      return badRequest("Passkey not found");
    }

    if (body.action === "delete") {
      const { error } = await service.auth.admin.passkey.deletePasskey({
        userId: auth.user.id,
        passkeyId: body.passkeyId,
      });
      if (error) throw error;
    }

    await writeAudit({
      userId: auth.user.id,
      action: `passkey_${body.action}` as "passkey_register" | "passkey_rename" | "passkey_delete",
      metadata: { passkeyId: body.passkeyId },
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("settings.passkeys", error);
  }
}
