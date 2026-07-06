import { NextRequest, NextResponse } from "next/server";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { writeAudit, getClientIp } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user } = auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return badRequest("Missing request body");
    }

    const { action, factorId } = body;
    if (!action || !["enroll", "unenroll"].includes(action)) {
      return badRequest("Invalid action: must be 'enroll' or 'unenroll'");
    }
    if (!factorId || typeof factorId !== "string") {
      return badRequest("Invalid factorId: must be a string");
    }

    const ip = getClientIp(req);
    await writeAudit({
      userId: user.id,
      action: action === "enroll" ? "mfa_enroll" : "mfa_unenroll",
      metadata: { factorId },
      ip,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse("api/settings/mfa", err);
  }
}
