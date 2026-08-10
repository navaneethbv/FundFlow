import { describe, expect, it, vi } from "vitest";
import { fetchInstitutionBranding } from "@/lib/plaid-institution";

const PNG_BASE64 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]).toString("base64");

describe("fetchInstitutionBranding", () => {
  it("requests optional metadata and returns validated branding", async () => {
    const institutionsGetById = vi.fn().mockResolvedValue({
      data: {
        institution: {
          name: "Test Bank",
          logo: PNG_BASE64,
          primary_color: "#A1B2C3",
        },
      },
    });

    const result = await fetchInstitutionBranding(
      { institutionsGetById } as never,
      { institutionId: "ins_1", countryCodes: ["US"] as never },
    );

    expect(institutionsGetById).toHaveBeenCalledWith({
      institution_id: "ins_1",
      country_codes: ["US"],
      options: { include_optional_metadata: true },
    });
    expect(result).toEqual({
      institutionId: "ins_1",
      name: "Test Bank",
      logo: PNG_BASE64,
      brandColor: "#a1b2c3",
    });
  });

  it("drops malformed logo and brand color payloads", async () => {
    const institutionsGetById = vi.fn().mockResolvedValue({
      data: {
        institution: {
          name: "Test Bank",
          logo: Buffer.from("not png").toString("base64"),
          primary_color: "blue",
        },
      },
    });

    await expect(fetchInstitutionBranding(
      { institutionsGetById } as never,
      { institutionId: "ins_1", countryCodes: ["US"] as never },
    )).resolves.toEqual({
      institutionId: "ins_1",
      name: "Test Bank",
      logo: null,
      brandColor: null,
    });
  });

  it("returns null instead of failing a connection when Plaid metadata fails", async () => {
    const institutionsGetById = vi.fn().mockRejectedValue(new Error("Plaid down"));

    await expect(fetchInstitutionBranding(
      { institutionsGetById } as never,
      { institutionId: "ins_1", countryCodes: ["US"] as never },
    )).resolves.toBeNull();
  });
});
