import { NextResponse, type NextRequest } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import { tryWriteDailyAccountSnapshots } from "@/lib/account-history";
import { getClientIp, writeAudit } from "@/lib/audit";

const ACCOUNT_TYPES = new Set([
  "asset",
  "liability",
  "cash",
  "investment",
  "debt",
]);

function validBalance(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validInclusion(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      accountType?: unknown;
      balance?: unknown;
      includeInNetWorth?: unknown;
    } | null;
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) {
      return badRequest("name must be between 1 and 120 characters");
    }
    if (
      typeof body?.accountType !== "string" ||
      !ACCOUNT_TYPES.has(body.accountType)
    ) {
      return badRequest("accountType is not supported");
    }
    if (!validBalance(body.balance)) {
      return badRequest("balance must be a finite number");
    }
    if (!validInclusion(body.includeInNetWorth)) {
      return badRequest("includeInNetWorth must be a boolean");
    }

    const service = createServiceClient();
    const { data: account, error } = await service
      .from("manual_accounts")
      .insert({
        user_id: user.id,
        name,
        account_type: body.accountType,
        balance: body.balance,
        include_in_net_worth: body.includeInNetWorth ?? true,
      })
      .select("id,name,account_type,balance,include_in_net_worth")
      .single();
    if (error) throw error;
    if (!account) throw new Error("Manual account create returned no row");

    await tryWriteDailyAccountSnapshots(user.id, "manual-accounts.create.snapshot");
    await writeAudit({
      userId: user.id,
      action: "manual_account_created",
      metadata: { account_id: account.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ account }, { status: 201 });
  } catch (error) {
    return errorResponse("manual-accounts.create", error);
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
      balance?: unknown;
      includeInNetWorth?: unknown;
    } | null;
    if (typeof body?.id !== "string" || !body.id) {
      return badRequest("id is required");
    }
    if (!validBalance(body.balance)) {
      return badRequest("balance must be a finite number");
    }
    if (!validInclusion(body.includeInNetWorth)) {
      return badRequest("includeInNetWorth must be a boolean");
    }

    const { data: visible, error: ownershipError } = await supabase
      .from("manual_accounts")
      .select("id")
      .eq("id", body.id)
      .maybeSingle();
    if (ownershipError) throw ownershipError;
    if (!visible) {
      return NextResponse.json(
        { error: "Manual account not found" },
        { status: 404 },
      );
    }

    const update: {
      balance: number;
      include_in_net_worth?: boolean;
    } = { balance: body.balance };
    const changedFields = ["balance"];
    if (typeof body.includeInNetWorth === "boolean") {
      update.include_in_net_worth = body.includeInNetWorth;
      changedFields.push("include_in_net_worth");
    }

    const service = createServiceClient();
    const { data: account, error } = await service
      .from("manual_accounts")
      .update(update)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id,name,account_type,balance,include_in_net_worth")
      .single();
    if (error) throw error;
    if (!account) throw new Error("Manual account update returned no row");

    await tryWriteDailyAccountSnapshots(user.id, "manual-accounts.update.snapshot");
    await writeAudit({
      userId: user.id,
      action: "manual_account_updated",
      metadata: {
        account_id: body.id,
        changed_fields: changedFields,
      },
      ip: getClientIp(request),
    });

    return NextResponse.json({ account });
  } catch (error) {
    return errorResponse("manual-accounts.update", error);
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user, supabase } = auth;

  try {
    const body = (await request.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (typeof body?.id !== "string" || !body.id) {
      return badRequest("id is required");
    }

    const { data: visible, error: ownershipError } = await supabase
      .from("manual_accounts")
      .select("id")
      .eq("id", body.id)
      .maybeSingle();
    if (ownershipError) throw ownershipError;
    if (!visible) {
      return NextResponse.json(
        { error: "Manual account not found" },
        { status: 404 },
      );
    }

    const service = createServiceClient();
    const { error } = await service
      .from("manual_accounts")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (error) throw error;

    await writeAudit({
      userId: user.id,
      action: "manual_account_deleted",
      metadata: { account_id: body.id },
      ip: getClientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse("manual-accounts.delete", error);
  }
}
