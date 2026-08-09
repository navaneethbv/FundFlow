import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  InstitutionAvatar,
  institutionLogoDataUri,
} from "@/components/ui/Avatar";

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
