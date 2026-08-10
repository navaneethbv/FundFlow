import { NextResponse, type NextRequest } from "next/server";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import {
  parseSinkingFundMutation,
  SINKING_FUND_SELECT,
  sinkingFundWrite,
} from "@/lib/sinking-funds";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    const parsed = parseSinkingFundMutation(
      await request.json().catch(() => null),
    );
    if ("error" in parsed) return badRequest(parsed.error);

    const service = createServiceClient();
    const { data: fund, error } = await service
      .from("sinking_funds")
      .insert({
        user_id: auth.user.id,
        ...sinkingFundWrite(parsed.value),
      })
      .select(SINKING_FUND_SELECT)
      .single();
    if (error) throw error;
    if (!fund) throw new Error("Sinking fund create returned no row");

    await writeAudit({
      userId: auth.user.id,
      action: "sinking_fund_created",
      metadata: { sinking_fund_id: fund.id },
      ip: getClientIp(request),
    });
    return NextResponse.json({ fund }, { status: 201 });
  } catch (error) {
    return errorResponse("sinking-funds.create", error);
  }
}
