import { NextResponse, type NextRequest } from "next/server";
import { ADVICE_LIBRARY } from "@/lib/advice-content";
import { validateAdvicePriorities, validateAdviceProfile } from "@/lib/advice";
import { getClientIp, writeAudit } from "@/lib/audit";
import { badRequest, errorResponse, requireUser } from "@/lib/http";
import { createServiceClient } from "@/lib/supabase/service";

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
      const item = ADVICE_LIBRARY.find((i) => i.id === adviceId);
      if (!item || !item.tasks.some((t) => t.id === taskId)) {
        return badRequest("unknown adviceId or taskId");
      }

      if (completed) {
        const { error } = await service.from("advice_progress").upsert(
          {
            user_id: user.id,
            advice_id: adviceId,
            task_id: taskId,
            content_version: item.version,
          },
          { onConflict: "user_id,advice_id,task_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await service
          .from("advice_progress")
          .delete()
          .eq("user_id", user.id)
          .eq("advice_id", adviceId)
          .eq("task_id", taskId);
        if (error) throw error;
      }

      await writeAudit({
        userId: user.id,
        action: "advice_task_toggled",
        metadata: { advice_id: adviceId },
        ip: getClientIp(request),
      });
      return NextResponse.json({ ok: true });
    }

    if (body.kind === "set_priorities") {
      const result = validateAdvicePriorities((body as { priorities?: unknown }).priorities, ADVICE_LIBRARY);
      if (!result.ok) return badRequest(result.error);

      const { error } = await service
        .from("profiles")
        .update({ advice_priorities: result.value })
        .eq("id", user.id);
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "advice_priorities_updated",
        metadata: { count: result.value.length },
        ip: getClientIp(request),
      });
      return NextResponse.json({ ok: true, priorities: result.value });
    }

    if (body.kind === "update_profile") {
      const result = validateAdviceProfile((body as { profile?: unknown }).profile);
      if (!result.ok) return badRequest(result.error);

      const { error } = await service
        .from("profiles")
        .update({ advice_profile: result.value })
        .eq("id", user.id);
      if (error) throw error;

      await writeAudit({
        userId: user.id,
        action: "advice_profile_updated",
        metadata: {},
        ip: getClientIp(request),
      });
      return NextResponse.json({ ok: true });
    }

    return badRequest("unknown kind");
  } catch (error) {
    return errorResponse("advice.patch", error);
  }
}
