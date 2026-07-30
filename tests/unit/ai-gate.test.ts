import { describe, it, expect, vi } from "vitest";
import { isAskAiAvailable } from "@/lib/ai-gate";

vi.mock("@/lib/ai-provider", () => ({ isAiProviderConfigured: vi.fn(() => true) }));

function fakeSupabase(aiSettingsEnabled: boolean | null, exportEnabled: boolean | null) {
  return {
    from: vi.fn((table: string) => {
      if (table === "ai_settings") {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: { enabled: aiSettingsEnabled } }),
            }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: { ai_export_enabled: exportEnabled } }),
          }),
        }),
      };
    }),
  } as never;
}

describe("isAskAiAvailable", () => {
  it("is true only when both ai_settings.enabled and profiles.ai_export_enabled are true", async () => {
    expect(await isAskAiAvailable(fakeSupabase(true, true), "u1")).toBe(true);
  });

  it("is false when ai_settings.enabled is false", async () => {
    expect(await isAskAiAvailable(fakeSupabase(false, true), "u1")).toBe(false);
  });

  it("is false when profiles.ai_export_enabled is false", async () => {
    expect(await isAskAiAvailable(fakeSupabase(true, false), "u1")).toBe(false);
  });

  it("is false when ai_settings.enabled is missing (no row yet)", async () => {
    expect(await isAskAiAvailable(fakeSupabase(null, true), "u1")).toBe(false);
  });
});
