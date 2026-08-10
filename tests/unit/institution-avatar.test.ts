import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  InstitutionAvatar,
  institutionLogoDataUri,
} from "@/components/ui/Avatar";
import {
  validateInstitutionLogo,
  normalizeBrandColor,
  fetchInstitutionBranding,
} from "@/lib/plaid-institution";

const PNG_BASE64 = "iVBORw0KGgoAAA==";

describe("InstitutionAvatar", () => {
  it("constructs a local PNG data URI from validated Plaid base64", () => {
    expect(institutionLogoDataUri(PNG_BASE64)).toBe(`data:image/png;base64,${PNG_BASE64}`);
    const html = renderToStaticMarkup(createElement(InstitutionAvatar, {
      name: "Bank",
      logoBase64: PNG_BASE64,
    }));

    expect(html).toContain(`src="data:image/png;base64,${PNG_BASE64}"`);
  });

  it("falls back to a deterministic initial for malformed logo data", () => {
    expect(institutionLogoDataUri("not-base64")).toBeNull();
    const html = renderToStaticMarkup(createElement(InstitutionAvatar, {
      name: "Bank",
      logoBase64: "not-base64",
    }));

    expect(html).not.toContain("<img");
    expect(html).toContain("B");
  });
});

describe("validateInstitutionLogo & normalizeBrandColor & fetchInstitutionBranding", () => {
  it("validates institution logo base64 string", () => {
    expect(validateInstitutionLogo(null)).toBeNull();
    expect(validateInstitutionLogo(123)).toBeNull();
    expect(validateInstitutionLogo("invalid!!base64")).toBeNull();
    // Valid PNG signature base64 prefix
    const validPngBase64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]).toString("base64");
    expect(validateInstitutionLogo(validPngBase64)).toBe(validPngBase64);

    // PNG signature mismatch
    const badPngBase64 = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]).toString("base64");
    expect(validateInstitutionLogo(badPngBase64)).toBeNull();
  });

  it("normalizes brand color hex", () => {
    expect(normalizeBrandColor(null)).toBeNull();
    expect(normalizeBrandColor("#ZZZZZZ")).toBeNull();
    expect(normalizeBrandColor("#112233")).toBe("#112233");
    expect(normalizeBrandColor("#AABBCC")).toBe("#aabbcc");
  });

  it("fetches institution branding and handles errors", async () => {
    const mockPlaid = {
      institutionsGetById: vi.fn().mockResolvedValue({
        data: {
          institution: {
            name: "Chase",
            logo: null,
            primary_color: "#112233",
          },
        },
      }),
    };

    const branding = await fetchInstitutionBranding(mockPlaid, {
      institutionId: "inst-1",
      countryCodes: ["US"] as never,
    });
    expect(branding).toEqual({
      institutionId: "inst-1",
      name: "Chase",
      logo: null,
      brandColor: "#112233",
    });

    mockPlaid.institutionsGetById.mockRejectedValue(new Error("API Error"));
    expect(
      await fetchInstitutionBranding(mockPlaid, {
        institutionId: "inst-1",
        countryCodes: ["US"] as never,
      }),
    ).toBeNull();
  });
});
