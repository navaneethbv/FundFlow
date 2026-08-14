import { NextResponse } from "next/server";
import { errorResponse, requireUser, type AuthedContext } from "@/lib/http";

export async function withUser<T>(
  context: string,
  handler: (auth: AuthedContext) => Promise<T>,
): Promise<T | NextResponse> {
  const auth = await requireUser();
  if (auth instanceof NextResponse) return auth;

  try {
    return await handler(auth);
  } catch (error) {
    return errorResponse(context, error);
  }
}
