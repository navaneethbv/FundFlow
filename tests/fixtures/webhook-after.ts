import { vi } from "vitest";
import type { NextRequest } from "next/server";

const queued = vi.hoisted(() => [] as Array<() => unknown>);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => queued.push(task),
}));

export async function drainWebhookWork() {
  const tasks = queued.splice(0);
  for (const task of tasks) await task();
}

export function withWebhookWork<T>(handler: (request: NextRequest) => Promise<T>) {
  return async (request: NextRequest) => {
    const response = await handler(request);
    await drainWebhookWork();
    return response;
  };
}
