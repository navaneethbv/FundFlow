import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import {
  parseSinkingFundMutation,
  SINKING_FUND_SELECT,
  sinkingFundWrite,
} from "@/lib/sinking-funds";
import { createServiceClient } from "@/lib/supabase/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    if (!id) return badRequest("id is required");
    const { data: visible, error: ownershipError } = await auth.supabase
      .from("sinking_funds")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (ownershipError) throw ownershipError;
    if (!visible) {
      return NextResponse.json({ error: "Sinking fund not found" }, { status: 404 });
    }

    const parsed = parseSinkingFundMutation(
      await request.json().catch(() => null),
    );
    if ("error" in parsed) return badRequest(parsed.error);

    const service = createServiceClient();
    const { data: fund, error } = await service
      .from("sinking_funds")
      .update(sinkingFundWrite(parsed.value))
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .select(SINKING_FUND_SELECT)
      .single();
    if (error) throw error;
    if (!fund) throw new Error("Sinking fund update returned no row");

    await writeAudit({
      userId: auth.user.id,
      action: "sinking_fund_updated",
      metadata: { sinking_fund_id: id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ fund });
  } catch (error) {
    return errorResponse("sinking-funds.update", error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const { id } = await params;
    if (!id) return badRequest("id is required");
    const { data: visible, error: ownershipError } = await auth.supabase
      .from("sinking_funds")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    if (ownershipError) throw ownershipError;
    if (!visible) {
      return NextResponse.json({ error: "Sinking fund not found" }, { status: 404 });
    }

    const service = createServiceClient();
    const { error } = await service
      .from("sinking_funds")
      .delete()
      .eq("id", id)
      .eq("user_id", auth.user.id);
    if (error) throw error;

    await writeAudit({
      userId: auth.user.id,
      action: "sinking_fund_deleted",
      metadata: { sinking_fund_id: id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse("sinking-funds.delete", error);
  }
}
