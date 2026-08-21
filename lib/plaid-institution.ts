import type { CountryCode, PlaidApi } from "plaid";

export interface InstitutionBranding {
  institutionId: string;
  name: string;
  logo: string | null;
  brandColor: string | null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_LOGO_BYTES = 512 * 1024;

export function validateInstitutionLogo(value: unknown): string | null {
  if (typeof value !== "string" || !value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    return null;
  }
  try {
    const decoded = Buffer.from(value, "base64");
    if (
      decoded.length < PNG_SIGNATURE.length ||
      decoded.length > MAX_LOGO_BYTES ||
      !decoded.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
    ) {
      return null;
    }
    return decoded.toString("base64") === value ? value : null;
  } catch {
    // c8 ignore next -- Buffer.from(value, "base64") never throws
    return null;
  }
}

export function normalizeBrandColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
    ? value.toLowerCase()
    : null;
}

export async function fetchInstitutionBranding(
  plaid: Pick<PlaidApi, "institutionsGetById">,
  input: { institutionId: string; countryCodes: CountryCode[] },
): Promise<InstitutionBranding | null> {
  try {
    const response = await plaid.institutionsGetById({
      institution_id: input.institutionId,
      country_codes: input.countryCodes,
      options: { include_optional_metadata: true },
    });
    const institution = response.data.institution;
    return {
      institutionId: input.institutionId,
      name: institution.name,
      logo: validateInstitutionLogo(institution.logo),
      brandColor: normalizeBrandColor(institution.primary_color),
    };
  } catch {
    return null;
  }
}
