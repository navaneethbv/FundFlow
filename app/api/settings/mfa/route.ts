import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { writeAudit, getClientIp } from "@/lib/audit";

type MfaAction = "enroll" | "verify" | "unenroll";

interface MfaFactor {
  id: string;
  status: string;
}

function getVerifiedFactors(data: unknown): MfaFactor[] {
  const factors = data as {
    totp?: MfaFactor[];
    phone?: MfaFactor[];
  } | null;

  return [...(factors?.totp ?? []), ...(factors?.phone ?? [])].filter(
    (factor) => factor.status === "verified",
  );
}

async function listVerifiedFactors(supabase: SupabaseClient): Promise<MfaFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return getVerifiedFactors(data);
}

async function setProfileMfaFlag(
  supabase: SupabaseClient,
  userId: string,
  enrolled: boolean,
) {
  const { error } = await supabase
    .from("profiles")
    .update({ mfa_enrolled: enrolled })
    .eq("id", userId);
  if (error) throw error;
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof Response) return auth;
  const { user, supabase } = auth;

  try {
    const body = await req.json().catch(() => null);
    if (!body) {
      return badRequest("Missing request body");
    }

    const { action, factorId } = body;
    if (!action || !["enroll", "verify", "unenroll"].includes(action)) {
      return badRequest("Invalid action: must be 'enroll', 'verify', or 'unenroll'");
    }
    if (!factorId || typeof factorId !== "string") {
      return badRequest("Invalid factorId: must be a string");
    }

    const mfaAction = action as MfaAction;
    let mfaEnrolled = false;

    if (mfaAction === "enroll") {
      const { data, error: factorError } = await supabase.auth.mfa.listFactors();
      if (factorError) throw factorError;
      const factor = [...(data?.totp ?? [])].find((candidate) => candidate.id === factorId);
      if (!factor) return badRequest("MFA factor does not belong to this user");
      if ((data?.totp ?? []).length > 10) {
        if (factor.status !== "verified") {
          await supabase.auth.mfa.unenroll({ factorId });
        }
        return badRequest("A maximum of ten TOTP factors is allowed");
      }
      const verifiedFactors = getVerifiedFactors(data);
      mfaEnrolled = verifiedFactors.length > 0;
    } else if (mfaAction === "verify") {
      const verifiedFactors = await listVerifiedFactors(supabase);
      const isVerified = verifiedFactors.some((factor) => factor.id === factorId);
      if (!isVerified) {
        return badRequest("MFA factor must be verified before finalizing enrollment");
      }
      await setProfileMfaFlag(supabase, user.id, true);
      mfaEnrolled = true;
    } else {
      const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
      if (unenrollError) throw unenrollError;

      const verifiedFactors = await listVerifiedFactors(supabase);
      mfaEnrolled = verifiedFactors.length > 0;
      await setProfileMfaFlag(supabase, user.id, mfaEnrolled);
    }

    const ip = getClientIp(req);
    await writeAudit({
      userId: user.id,
      action:
        mfaAction === "enroll"
          ? "mfa_enroll"
          : mfaAction === "verify"
            ? "mfa_verify"
            : "mfa_unenroll",
      metadata: { factorId },
      ip,
    });

    return NextResponse.json({
      success: true,
      mfa_enrolled: mfaEnrolled,
    });
  } catch (err) {
    return errorResponse("api/settings/mfa", err);
  }
}
