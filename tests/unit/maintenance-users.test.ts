import { describe, expect, it } from "vitest";
import { loadMaintenanceUsers } from "@/lib/maintenance-users";
import { clientStub } from "../fixtures/supabase-query";
describe("maintenance user discovery", () => {
  it("includes manual-only users across pages and deduplicates bank users", async () => {
    const profiles = Array.from({ length: 1001 }, (_, id) => ({ id: `user-${id}` }));
    const service = clientStub({ profiles: { data: profiles } });
    const users = await loadMaintenanceUsers(service as never, new Set(["user-0", "bank-only"]));
    expect(users).toHaveLength(1002); expect(users).toContain("user-1000"); expect(users).toContain("bank-only");
    expect(service.callsOn("profiles").filter(call => call.method === "range").map(call => call.args)).toEqual([[0, 499], [500, 999], [1000, 1499]]);
  });
  it("surfaces discovery failures instead of reporting incomplete success", async () => {
    const error = { code: "XX000" };
    await expect(loadMaintenanceUsers(clientStub({ profiles: { error } }) as never, new Set())).rejects.toEqual(error);
  });
  it("keeps known bank users if there are no profile rows", async () => {
    expect(await loadMaintenanceUsers(clientStub() as never, new Set(["bank"]))).toEqual(["bank"]);
  });
});
