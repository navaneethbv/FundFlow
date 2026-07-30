import { NextResponse } from "next/server";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { writeAudit } from "@/lib/audit";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YYYY_MM_REGEX = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const BUDGET_GROUPS = [
  "income",
  "fixed",
  "flexible",
  "non_monthly",
] as const;

type BudgetGroup = (typeof BUDGET_GROUPS)[number];

interface UpdateBudgetRequest {
  budget_id: string;
  month: string;
  planned: number;
  group_name?: BudgetGroup;
  rollover_enabled?: boolean;
  sort_order?: number;
}

interface SavedBudgetRow {
  budget_id: string;
  month: string;
  planned: number | string;
  group_name: BudgetGroup;
  rollover_enabled: boolean;
  sort_order: number;
}

interface ProposalItem {
  category: string;
  monthly_limit: number;
  group_name: BudgetGroup;
  rollover_enabled: boolean;
  sort_order: number;
}

function hasAtMostTwoDecimals(value: number): boolean {
  return Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
}

function parseUpdateBody(value: unknown):
  | { ok: true; value: UpdateBudgetRequest }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }

  const body = value as Record<string, unknown>;
  if (
    typeof body.budget_id !== "string" ||
    !UUID_REGEX.test(body.budget_id)
  ) {
    return { ok: false, message: "Invalid budget_id" };
  }
  if (typeof body.month !== "string" || !YYYY_MM_REGEX.test(body.month)) {
    return { ok: false, message: "Invalid month" };
  }
  if (
    typeof body.planned !== "number" ||
    !Number.isFinite(body.planned) ||
    body.planned < 0 ||
    !hasAtMostTwoDecimals(body.planned)
  ) {
    return { ok: false, message: "Invalid planned amount" };
  }
  if (
    body.group_name !== undefined &&
    (typeof body.group_name !== "string" ||
      !BUDGET_GROUPS.includes(body.group_name as BudgetGroup))
  ) {
    return { ok: false, message: "Invalid group_name" };
  }
  if (
    body.rollover_enabled !== undefined &&
    typeof body.rollover_enabled !== "boolean"
  ) {
    return { ok: false, message: "Invalid rollover_enabled" };
  }
  if (
    body.sort_order !== undefined &&
    (typeof body.sort_order !== "number" ||
      !Number.isInteger(body.sort_order) ||
      body.sort_order < 0)
  ) {
    return { ok: false, message: "Invalid sort_order" };
  }

  return {
    ok: true,
    value: {
      budget_id: body.budget_id,
      month: body.month,
      planned: body.planned,
      group_name: body.group_name as BudgetGroup | undefined,
      rollover_enabled: body.rollover_enabled as boolean | undefined,
      sort_order: body.sort_order as number | undefined,
    },
  };
}

function parseProposalBody(value: unknown):
  | { ok: true; month: string; items: ProposalItem[] }
  | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, message: "Invalid JSON payload" };
  }
  const body = value as Record<string, unknown>;
  if (typeof body.month !== "string" || !YYYY_MM_REGEX.test(body.month)) {
    return { ok: false, message: "Invalid month" };
  }
  if (
    !Array.isArray(body.items) ||
    body.items.length === 0 ||
    body.items.length > 200
  ) {
    return { ok: false, message: "Invalid proposal items" };
  }

  const categories = new Set<string>();
  const items: ProposalItem[] = [];
  for (const candidate of body.items) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, message: "Invalid proposal item" };
    }
    const item = candidate as Record<string, unknown>;
    const category =
      typeof item.category === "string" ? item.category.trim() : "";
    const normalizedCategory = category.toLowerCase();
    if (
      category.length < 1 ||
      category.length > 120 ||
      categories.has(normalizedCategory)
    ) {
      return { ok: false, message: "Invalid proposal category" };
    }
    if (
      typeof item.monthly_limit !== "number" ||
      !Number.isFinite(item.monthly_limit) ||
      item.monthly_limit < 0 ||
      !hasAtMostTwoDecimals(item.monthly_limit)
    ) {
      return { ok: false, message: "Invalid proposal amount" };
    }
    if (
      typeof item.group_name !== "string" ||
      !BUDGET_GROUPS.includes(item.group_name as BudgetGroup)
    ) {
      return { ok: false, message: "Invalid proposal group" };
    }
    if (typeof item.rollover_enabled !== "boolean") {
      return { ok: false, message: "Invalid proposal rollover" };
    }
    if (
      typeof item.sort_order !== "number" ||
      !Number.isInteger(item.sort_order) ||
      item.sort_order < 0
    ) {
      return { ok: false, message: "Invalid proposal sort order" };
    }
    categories.add(normalizedCategory);
    items.push({
      category,
      monthly_limit: item.monthly_limit,
      group_name: item.group_name as BudgetGroup,
      rollover_enabled: item.rollover_enabled,
      sort_order: item.sort_order,
    });
  }
  return { ok: true, month: body.month, items };
}

export async function PUT(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseUpdateBody(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);

    const input = parsed.value;
    const firstOfMonth = `${input.month}-01`;
    const changedFields = ["planned"];
    if (input.group_name !== undefined) changedFields.push("group_name");
    if (input.rollover_enabled !== undefined) {
      changedFields.push("rollover_enabled");
    }
    if (input.sort_order !== undefined) changedFields.push("sort_order");

    const { data, error } = await supabase.rpc("update_budget_period", {
      p_budget_id: input.budget_id,
      p_month: firstOfMonth,
      p_planned: input.planned,
      p_group_name: input.group_name ?? null,
      p_rollover_enabled: input.rollover_enabled ?? null,
      p_sort_order: input.sort_order ?? null,
    });

    if (error?.code === "P0002") {
      return NextResponse.json(
        { error: "Budget not found" },
        { status: 404 },
      );
    }
    if (error) return errorResponse("budget.update", error);

    const saved = (Array.isArray(data) ? data[0] : data) as
      | SavedBudgetRow
      | null;
    if (!saved) {
      return errorResponse(
        "budget.update",
        new Error("Budget update returned no row"),
      );
    }

    await writeAudit({
      userId: user.id,
      action: "budget_updated",
      metadata: {
        budget_id: input.budget_id,
        month: firstOfMonth,
        changed_fields: changedFields,
      },
    });

    return NextResponse.json({
      budget_id: saved.budget_id,
      month: saved.month,
      planned: Number(saved.planned),
      group_name: saved.group_name,
      rollover_enabled: saved.rollover_enabled,
      sort_order: saved.sort_order,
    });
  } catch (error) {
    return errorResponse("budget.update", error);
  }
}

export async function POST(request: Request) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const parsed = parseProposalBody(await request.json().catch(() => null));
    if (!parsed.ok) return badRequest(parsed.message);

    const { data: existingRows, error: existingError } = await supabase
      .from("budgets")
      .select("id,category")
      .eq("user_id", user.id)
      .limit(5000);
    if (existingError) {
      return errorResponse("budget.proposals.read", existingError);
    }

    const existingCategories = new Set(
      (existingRows ?? []).map((row) =>
        String(row.category).trim().toLowerCase(),
      ),
    );
    const skipped = parsed.items
      .filter((item) =>
        existingCategories.has(item.category.toLowerCase()),
      )
      .map((item) => item.category);
    const newItems = parsed.items.filter(
      (item) => !existingCategories.has(item.category.toLowerCase()),
    );

    let created: { id: string; category: string }[] = [];
    if (newItems.length > 0) {
      const { data, error } = await supabase
        .from("budgets")
        .insert(
          newItems.map((item) => ({
            user_id: user.id,
            ...item,
          })),
        )
        .select("id,category");
      if (error) return errorResponse("budget.proposals.create", error);
      created = (data ?? []).map((row) => ({
        id: row.id as string,
        category: row.category as string,
      }));
    }

    if (created.length > 0) {
      await writeAudit({
        userId: user.id,
        action: "budget_proposals_created",
        metadata: {
          month: `${parsed.month}-01`,
          created_budget_ids: created.map((row) => row.id),
          skipped_count: skipped.length,
        },
      });
    }

    return NextResponse.json({ created, skipped });
  } catch (error) {
    return errorResponse("budget.proposals", error);
  }
}
