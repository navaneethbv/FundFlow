import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireUser, errorResponse, badRequest } from "@/lib/http";
import { writeAudit, getClientIp, type AuditAction } from "@/lib/audit";

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

function resolveMfaAuditAction(action: MfaAction): AuditAction {
  if (action === "enroll") return "mfa_enroll";
  if (action === "verify") return "mfa_verify";
  return "mfa_unenroll";
}

async function handleMfaEnroll(
  supabase: SupabaseClient,
  factorId: string,
): Promise<{ mfaEnrolled?: boolean; errorResponse?: NextResponse }> {
  const { data, error: factorError } = await supabase.auth.mfa.listFactors();
  if (factorError) throw factorError;
  const factor = [...(data?.totp ?? [])].find((candidate) => candidate.id === factorId);
  if (!factor) return { errorResponse: badRequest("MFA factor does not belong to this user") };
  if ((data?.totp ?? []).length > 10) {
    if (factor.status !== "verified") {
      await supabase.auth.mfa.unenroll({ factorId });
    }
    return { errorResponse: badRequest("A maximum of ten TOTP factors is allowed") };
  }
  const verifiedFactors = getVerifiedFactors(data);
  return { mfaEnrolled: verifiedFactors.length > 0 };
}

async function handleMfaVerify(
  supabase: SupabaseClient,
  userId: string,
  factorId: string,
): Promise<{ mfaEnrolled?: boolean; errorResponse?: NextResponse }> {
  const verifiedFactors = await listVerifiedFactors(supabase);
  const isVerified = verifiedFactors.some((factor) => factor.id === factorId);
  if (!isVerified) {
    return { errorResponse: badRequest("MFA factor must be verified before finalizing enrollment") };
  }
  await setProfileMfaFlag(supabase, userId, true);
  return { mfaEnrolled: true };
}

async function handleMfaUnenroll(
  supabase: SupabaseClient,
  userId: string,
  factorId: string,
): Promise<{ mfaEnrolled: boolean }> {
  const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
  if (unenrollError) throw unenrollError;

  const verifiedFactors = await listVerifiedFactors(supabase);
  const mfaEnrolled = verifiedFactors.length > 0;
  await setProfileMfaFlag(supabase, userId, mfaEnrolled);
  return { mfaEnrolled };
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
      const res = await handleMfaEnroll(supabase, factorId);
      if (res.errorResponse) return res.errorResponse;
      mfaEnrolled = res.mfaEnrolled!;
    } else if (mfaAction === "verify") {
      const res = await handleMfaVerify(supabase, user.id, factorId);
      if (res.errorResponse) return res.errorResponse;
      mfaEnrolled = res.mfaEnrolled!;
    } else {
      const res = await handleMfaUnenroll(supabase, user.id, factorId);
      mfaEnrolled = res.mfaEnrolled;
    }

    const ip = getClientIp(req);
    await writeAudit({
      userId: user.id,
      action: resolveMfaAuditAction(mfaAction),
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
