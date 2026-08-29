import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, refreshMock, stateSetters, renderResult } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  stateSetters: [] as Array<ReturnType<typeof vi.fn>>,
  renderResult: { current: null as unknown },
}));

vi.mock("react", () => ({
  useState: (value: unknown) => {
    const setter = vi.fn();
    stateSetters.push(setter);
    return [value, setter];
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/components/ui/Button", () => ({
  default: ({ children }: { children: unknown }) => children,
}));

vi.mock("@/components/settings/ReconnectBankButton", () => ({
  default: () => null,
}));

const { default: RepairBankButton } = await import(
  "@/components/settings/RepairBankButton"
);

function phaseSetter(): ReturnType<typeof vi.fn> {
  // [phase, setPhase], [state, setState] -> phase setter is index 1
  return stateSetters[1];
}

describe("RepairBankButton", () => {
  beforeEach(() => {
    stateSetters.length = 0;
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to the repair route with the item id and shows a running state", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: "repaired",
          pagesCompleted: 2,
          maxPages: 8,
          completed: true,
          added: 4,
          modified: 1,
          removed: 0,
        }),
    });

    renderResult.current = RepairBankButton({ itemId: "item-1" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/plaid/repair",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: "item-1" }),
      }),
    );
    // Running state was set before the fetch resolved.
    expect(phaseSetter()).toHaveBeenCalledWith("running");
  });

  it("shows a retry-able bounded backfill message", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          ok: true,
          status: "backfill_incomplete",
          pagesCompleted: 5,
          maxPages: 8,
          completed: false,
          added: 40,
          modified: 0,
          removed: 0,
        }),
    });

    renderResult.current = RepairBankButton({ itemId: "item-1" });
    // Await the async handler.
    await Promise.resolve();
    await Promise.resolve();

    const [messageSetter] = stateSetters;
    expect(messageSetter).toHaveBeenCalled();
    const setPhase = stateSetters[1];
    expect(setPhase).toHaveBeenCalledWith("bounded");
  });

  it("surfaces a provider-conditional reconnect message", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 200,
      json: () =>
        Promise.resolve({
          ok: false,
          status: "institution_login_required",
          message: "Log in again.",
        }),
    });

    renderResult.current = RepairBankButton({ itemId: "item-1" });
    await Promise.resolve();
    await Promise.resolve();

    const [messageSetter] = stateSetters;
    expect(messageSetter).toHaveBeenCalledWith(expect.stringContaining("log in again"));
  });
});