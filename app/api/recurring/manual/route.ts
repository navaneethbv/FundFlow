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

type PatchFieldResult = { ok: true; value: unknown } | { ok: false; message: string };

function parsePatchName(value: unknown): PatchFieldResult {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > 140) {
    return { ok: false, message: "Invalid name" };
  }
  return { ok: true, value: value.trim() };
}

function parsePatchAmount(value: unknown): PatchFieldResult {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? { ok: true, value }
    : { ok: false, message: "Invalid amount" };
}

function parsePatchFrequency(value: unknown): PatchFieldResult {
  return typeof value === "string" && FREQUENCIES.includes(value as never)
    ? { ok: true, value }
    : { ok: false, message: "Invalid frequency" };
}

function parsePatchDate(value: unknown): PatchFieldResult {
  return typeof value === "string" && DATE_REGEX.test(value)
    ? { ok: true, value }
    : { ok: false, message: "Invalid next_date" };
}

function parsePatchItemType(value: unknown): PatchFieldResult {
  return typeof value === "string" && ITEM_TYPES.includes(value as never)
    ? { ok: true, value }
    : { ok: false, message: "Invalid item_type" };
}

function parsePatchCategory(value: unknown): PatchFieldResult {
  return value === null || typeof value === "string"
    ? { ok: true, value }
    : { ok: false, message: "Invalid category" };
}

function parsePatchEnabled(value: unknown): PatchFieldResult {
  return typeof value === "boolean"
    ? { ok: true, value }
    : { ok: false, message: "Invalid enabled" };
}

const PATCH_PARSERS: Record<string, (value: unknown) => PatchFieldResult> = {
  name: parsePatchName,
  amount: parsePatchAmount,
  frequency: parsePatchFrequency,
  next_date: parsePatchDate,
  item_type: parsePatchItemType,
  category: parsePatchCategory,
  enabled: parsePatchEnabled,
};

function parseManualPatch(
  body: Record<string, unknown>,
): { ok: true; id: string; patch: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof body.id !== "string" || !UUID_REGEX.test(body.id)) {
    return { ok: false, message: "Invalid id" };
  }
  const patch: Record<string, unknown> = {};
  for (const [field, parse] of Object.entries(PATCH_PARSERS)) {
    if (body[field] === undefined) continue;
    const result = parse(body[field]);
    if (!result.ok) return result;
    patch[field] = result.value;
  }
  return { ok: true, id: body.id, patch };
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
    if (!body) return badRequest("Invalid JSON payload");
    const parsed = parseManualPatch(body);
    if (!parsed.ok) return badRequest(parsed.message);
    const { id, patch } = parsed;

    const { data, error } = await supabase
      .from("manual_recurring_items")
      .update(patch)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return errorResponse("recurring.manual.update", error);
    if (!data) return NextResponse.json({ error: "Manual item not found" }, { status: 404 });

    await writeAudit({
      userId: user.id,
      action: "manual_recurring_item_updated",
      metadata: { id, changed_fields: Object.keys(patch) },
    });

    return NextResponse.json({ id });
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
