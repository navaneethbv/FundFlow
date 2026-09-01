import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Field from "@/components/ui/Field";
import Input, { fieldClasses } from "@/components/ui/Input";

/**
 * Field ARIA chain & focus ring (frontend-review R8):
 * - Error paragraph carries id="${htmlFor}-error" and role="alert".
 * - Control child is injected with aria-invalid="true" and aria-describedby="${htmlFor}-error".
 * - Hint carries id="${htmlFor}-hint" and links to aria-describedby when no error.
 * - fieldClasses drops focus:outline-none in favor of focus:outline-2.
 */
describe("Field ARIA chain & focus styling", () => {
  it("associates error with child control via aria-describedby, aria-invalid, and role=alert", () => {
    const html = renderToStaticMarkup(
      createElement(
        Field,
        {
          label: "Email address",
          htmlFor: "email-field",
          error: "Please enter a valid email.",
        },
        createElement(Input, { id: "email-field" }),
      ),
    );

    expect(html).toContain('id="email-field-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="email-field-error"');
    expect(html).toContain("Please enter a valid email.");
  });

  it("associates hint with child control when no error is present", () => {
    const html = renderToStaticMarkup(
      createElement(
        Field,
        {
          label: "Username",
          htmlFor: "username-field",
          hint: "Must be at least 3 characters.",
        },
        createElement(Input, { id: "username-field" }),
      ),
    );

    expect(html).toContain('id="username-field-hint"');
    expect(html).toContain('aria-describedby="username-field-hint"');
    expect(html).not.toContain('aria-invalid="true"');
    expect(html).not.toContain('role="alert"');
  });

  it("renders role=alert for errors without htmlFor", () => {
    const html = renderToStaticMarkup(
      createElement(
        Field,
        {
          label: "Unbound field",
          error: "Generic error message",
        },
        createElement("div", null, "child"),
      ),
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain("Generic error message");
  });

  it("fieldClasses provides accessible outline and drops focus:outline-none", () => {
    expect(fieldClasses).not.toContain("focus:outline-none");
    expect(fieldClasses).toContain("focus:outline-2");
  });
});
