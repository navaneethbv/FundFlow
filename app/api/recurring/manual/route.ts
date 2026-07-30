import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly", "yearly"] as const;
const ITEM_TYPES = ["income", "expense"] as const;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface CreateBody {
  name: string;
  amount: number;
  frequency: (typeof FREQUENCIES)[number];
  next_date: string;
  item_type: (typeof ITEM_TYPES)[number];
  category: string | null;
}

function parseCreate(value: unknown): { ok: true; value: CreateBody } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 140) return { ok: false, message: "Invalid name" };
  if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
    return { ok: false, message: "Invalid amount" };
  }
  if (typeof body.frequency !== "string" || !FREQUENCIES.includes(body.frequency as never)) {
    return { ok: false, message: "Invalid frequency" };
  }
  if (typeof body.next_date !== "string" || !DATE_REGEX.test(body.next_date)) {
    return { ok: false, message: "Invalid next_date" };
  }
  if (typeof body.item_type !== "string" || !ITEM_TYPES.includes(body.item_type as never)) {
    return { ok: false, message: "Invalid item_type" };
  }
  if (body.category !== undefined && body.category !== null && typeof body.category !== "string") {
    return { ok: false, message: "Invalid category" };
  }
  return {
    ok: true,
    value: {
      name,
      amount: body.amount,
      frequency: body.frequency as CreateBody["frequency"],
      next_date: body.next_date,
      item_type: body.item_type as CreateBody["item_type"],
      category: (body.category as string | null) ?? null,
    },
  };
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseCreate(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .insert({ user_id: user.id, ...parsed.value, enabled: true })
      .select("id")
      .single();
    if (error) return errorResponse("recurring.manual.create", error);

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_created",
      metadata: { id: (data as { id: string }).id },
    });

    return NextResponse.json({ id: (data as { id: string }).id });
  } catch (error) {
    return errorResponse("recurring.manual.create", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !UUID_REGEX.test(body.id)) {
      return badRequest("Invalid id");
    }
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 1) return badRequest("Invalid name");
      patch.name = body.name.trim();
    }
    if (body.amount !== undefined) {
      if (typeof body.amount !== "number" || !Number.isFinite(body.amount) || body.amount <= 0) {
        return badRequest("Invalid amount");
      }
      patch.amount = body.amount;
    }
    if (body.frequency !== undefined) {
      if (typeof body.frequency !== "string" || !FREQUENCIES.includes(body.frequency as never)) {
        return badRequest("Invalid frequency");
      }
      patch.frequency = body.frequency;
    }
    if (body.next_date !== undefined) {
      if (typeof body.next_date !== "string" || !DATE_REGEX.test(body.next_date)) {
        return badRequest("Invalid next_date");
      }
      patch.next_date = body.next_date;
    }
    if (body.item_type !== undefined) {
      if (typeof body.item_type !== "string" || !ITEM_TYPES.includes(body.item_type as never)) {
        return badRequest("Invalid item_type");
      }
      patch.item_type = body.item_type;
    }
    if (body.category !== undefined) {
      if (body.category !== null && typeof body.category !== "string") return badRequest("Invalid category");
      patch.category = body.category;
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") return badRequest("Invalid enabled");
      patch.enabled = body.enabled;
    }

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .update(patch)
      .eq("id", body.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return errorResponse("recurring.manual.update", error);
    if (!data) return NextResponse.json({ error: "Manual item not found" }, { status: 404 });

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_updated",
      metadata: { id: body.id, changed_fields: Object.keys(patch) },
    });

    return NextResponse.json({ id: body.id });
  } catch (error) {
    return errorResponse("recurring.manual.update", error);
  }
}

export async function DELETE(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body.id !== "string" || !UUID_REGEX.test(body.id)) {
      return badRequest("Invalid id");
    }

    const { error } = await supabase
      .from("manual_recurring_items")
      .delete()
      .eq("id", body.id)
      .eq("user_id", user.id);
    if (error) return errorResponse("recurring.manual.delete", error);

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_deleted",
      metadata: { id: body.id },
    });

    return NextResponse.json({ id: body.id });
  } catch (error) {
    return errorResponse("recurring.manual.delete", error);
  }
}
