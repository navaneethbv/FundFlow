import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import PopoverBackdrop from "@/components/ui/PopoverBackdrop";
import { usePopoverMenu } from "@/lib/use-popover-menu";

describe("usePopoverMenu & PopoverBackdrop", () => {
  it("exports usePopoverMenu hook function", () => {
    expect(typeof usePopoverMenu).toBe("function");
  });

  it("renders PopoverBackdrop with accessibility attributes", () => {
    const onClose = vi.fn();
    const html = renderToStaticMarkup(
      createElement(PopoverBackdrop, { onClose, zIndex: "z-40" }),
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("fixed inset-0 z-40 cursor-default");
  });
});
