import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock, refreshMock, usePlaidLinkMock, stateSetters } = vi.hoisted(
  () => ({
    fetchMock: vi.fn(),
    refreshMock: vi.fn(),
    usePlaidLinkMock: vi.fn(),
    stateSetters: [] as Array<ReturnType<typeof vi.fn>>,
  }),
);

vi.mock("react", () => ({
  useCallback: (callback: unknown) => callback,
  useEffect: () => undefined,
  useRef: (value: unknown) => ({ current: value }),
  useState: (value: unknown) => {
    const setter = vi.fn();
    stateSetters.push(setter);
    return [value, setter];
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("react-plaid-link", () => ({
  usePlaidLink: usePlaidLinkMock,
}));

vi.mock("@/components/ui/Button", () => ({
  default: () => null,
}));

const { default: ConnectBankButton } = await import(
  "@/components/ConnectBankButton"
);

describe("ConnectBankButton Plaid success handling", () => {
  beforeEach(() => {
    stateSetters.length = 0;
    fetchMock.mockReset();
    refreshMock.mockReset();
    usePlaidLinkMock.mockReset();
    usePlaidLinkMock.mockReturnValue({ open: vi.fn(), ready: false });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects a null public token without exchanging it", async () => {
    const tree = ConnectBankButton() as unknown as {
      props: {
        children: Array<{
          props?: { onSuccess?: (token: string | null) => Promise<void> };
        }>;
      };
    };

    const launcher = tree.props.children.find((child) => child.props?.onSuccess);
    await launcher?.props?.onSuccess?.(null);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(stateSetters[4]).toHaveBeenCalledWith(
      "Bank connection did not return a public token.",
    );
  });
});
