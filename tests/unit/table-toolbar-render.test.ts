import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TableToolbar from "@/components/transactions/TableToolbar";

describe("TableToolbar", () => {
  it("renders the shared Sort control once with Edit multiple and Columns", () => {
    const html = renderToStaticMarkup(
      createElement(TableToolbar, {
        bulkTagBar: createElement("div", null, "BULK_TAG_BAR_CONTENT"),
        columnsMenu: createElement("div", null, "COLUMNS_MENU_CONTENT"),
        sortMenu: createElement("div", null, "SHARED_SORT_MENU"),
      }),
    );
    expect(html.match(/SHARED_SORT_MENU/g)).toHaveLength(1);
    expect(html).toContain("Edit multiple");
    expect(html).toContain("Columns");
    expect(html).not.toContain("BULK_TAG_BAR_CONTENT");
    expect(html).not.toContain("COLUMNS_MENU_CONTENT");
  });

  it("omits the Columns trigger entirely when no columnsMenu is given", () => {
    const html = renderToStaticMarkup(
      createElement(TableToolbar, {
        bulkTagBar: createElement("div", null, "BULK_TAG_BAR_CONTENT"),
      }),
    );
    expect(html).toContain("Edit multiple");
    expect(html).not.toContain("Columns");
  });
});
