import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ExternalServicesSection from "@/components/settings/ExternalServicesSection";
import { EXTERNAL_SERVICES } from "@/lib/external-services";

describe("external service registry", () => {
  it("covers the providers named by the privacy checklist", () => {
    expect(EXTERNAL_SERVICES.map((service) => service.key)).toEqual([
      "supabase",
      "plaid",
      "email",
      "web-push",
      "anthropic",
    ]);
    for (const service of EXTERNAL_SERVICES) {
      expect(service.purpose).not.toBe("");
      expect(service.dataSent).not.toBe("");
      expect(service.trigger).not.toBe("");
      expect(service.sourceFiles.length).toBeGreaterThan(0);
    }
  });

  it("renders purpose, data, trigger, optionality, and source files", () => {
    const html = renderToStaticMarkup(createElement(ExternalServicesSection));
    expect(html).toContain("External services");
    expect(html).toContain("Data sent or received");
    expect(html).toContain("Source files");
    expect(html).toContain("Anthropic");
    expect(html).toContain("Opt-in");
    expect(html).toContain("lib/ai-provider.ts");
  });
});
