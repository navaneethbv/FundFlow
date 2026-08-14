import { NextResponse, type NextRequest } from "next/server";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { validateAdvicePriorities, validateAdviceProfile } from "@/lib/advice";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";
import type { SupabaseClient } from "@supabase/supabase-js";

type AdviceService = SupabaseClient;

async function toggleTask(
  service: AdviceService,
  userId: string,
  adviceId: string,
  taskId: string,
  completed: boolean,
  request: NextRequest,
) {
  const item = ADVICE_LIBRARY.find((candidate) => candidate.id === adviceId);
  if (item?.tasks.some((task) => task.id === taskId) !== true) {
    return badRequest("unknown adviceId or taskId");
  }
  if (completed) {
    const { error } = await service.from("advice_progress").upsert(
      { user_id: userId, advice_id: adviceId, task_id: taskId, content_version: item.version },
      { onConflict: "user_id,advice_id,task_id" },
    );
    if (error) throw error;
  } else {
    const { error } = await service
      .from("advice_progress")
      .delete()
      .eq("user_id", userId)
      .eq("advice_id", adviceId)
      .eq("task_id", taskId);
    if (error) throw error;
  }
  await writeAudit({
    userId,
    action: "advice_task_toggled",
    metadata: { advice_id: adviceId },
    ip: getClientIp(request),
  });
  return NextResponse.json({ ok: true });
}

async function setPriorities(
  service: AdviceService,
  userId: string,
  value: unknown,
  request: NextRequest,
) {
  const result = validateAdvicePriorities(value, ADVICE_LIBRARY);
  if (!result.ok) return badRequest(result.error);
  const { error } = await service
    .from("profiles")
    .update({ advice_priorities: result.value })
    .eq("id", userId);
  if (error) throw error;
  await writeAudit({
    userId,
    action: "advice_priorities_updated",
    metadata: { count: result.value.length },
    ip: getClientIp(request),
  });
  return NextResponse.json({ ok: true, priorities: result.value });
}

async function updateProfile(
  service: AdviceService,
  userId: string,
  value: unknown,
  request: NextRequest,
) {
  const result = validateAdviceProfile(value);
  if (!result.ok) return badRequest(result.error);
  const { error } = await service
    .from("profiles")
    .update({ advice_profile: result.value })
    .eq("id", userId);
  if (error) throw error;
  await writeAudit({
    userId,
    action: "advice_profile_updated",
    metadata: {},
    ip: getClientIp(request),
  });
  return NextResponse.json({ ok: true });
}

/**
 * Three idempotent operations behind one route, matching the plan's
 * "toggles stable task ids, saves priorities, and updates profile answers
 * idempotently." Audit metadata is deliberately thin — an advice id, never
 * the profile answers themselves — since those answers are personal and
 * belong only in `profiles.advice_profile`, not the audit trail.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;
  const { user } = auth;

  try {
    const body = (await request.json().catch(() => null)) as { kind?: unknown } | null;
    if (!body || typeof body.kind !== "string") {
      return badRequest("kind is required");
    }

    const service = createServiceClient();

    if (body.kind === "toggle_task") {
      const { adviceId, taskId, completed } = body as {
        adviceId?: unknown;
        taskId?: unknown;
        completed?: unknown;
      };
      if (typeof adviceId !== "string" || typeof taskId !== "string" || typeof completed !== "boolean") {
        return badRequest("adviceId, taskId, and completed are required");
      }
      return toggleTask(service, user.id, adviceId, taskId, completed, request);
    }

    if (body.kind === "set_priorities") {
      return setPriorities(
        service,
        user.id,
        (body as { priorities?: unknown }).priorities,
        request,
      );
    }

    if (body.kind === "update_profile") {
      return updateProfile(
        service,
        user.id,
        (body as { profile?: unknown }).profile,
        request,
      );
    }

    return badRequest("unknown kind");
  } catch (error) {
    return errorResponse("advice.patch", error);
  }
}
