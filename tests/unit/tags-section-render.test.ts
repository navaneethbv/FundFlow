import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

import TagsSection from "@/components/settings/TagsSection";

describe("TagsSection", () => {
  it("labels every rename input with a unique id and matching htmlFor", () => {
    const html = renderToStaticMarkup(
      createElement(TagsSection, {
        initialTags: [
          { id: "tag-1", name: "Work" },
          { id: "tag-2", name: "Travel" },
        ],
      }),
    );

    expect(html).toContain('for="tag-rename-tag-1"');
    expect(html).toContain('id="tag-rename-tag-1"');
    expect(html).toContain('for="tag-rename-tag-2"');
    expect(html).toContain('id="tag-rename-tag-2"');
    expect(html).toContain(">Rename Work</label>");
    expect(html).toContain(">Rename Travel</label>");
  });

  it("labels the new-tag input", () => {
    const html = renderToStaticMarkup(
      createElement(TagsSection, { initialTags: [] }),
    );
    expect(html).toContain('for="new-tag-name"');
    expect(html).toContain('id="new-tag-name"');
    expect(html).toContain(">New tag name</label>");
  });

  it("keeps the empty message outside the ul so no bare p sits in the list", () => {
    const html = renderToStaticMarkup(
      createElement(TagsSection, { initialTags: [] }),
    );
    // The message renders after the list closes rather than inside it.
    expect(html).toContain("No tags yet.");
    expect(html).toContain("</ul>");
    expect(html.indexOf("No tags yet.")).toBeGreaterThan(html.indexOf("</ul>"));
  });

  it("keeps only li elements as direct ul children", () => {
    const html = renderToStaticMarkup(
      createElement(TagsSection, {
        initialTags: [
          { id: "tag-1", name: "Work" },
          { id: "tag-2", name: "Travel" },
        ],
      }),
    );
    const ulStart = html.indexOf("<ul");
    const ulEnd = html.indexOf("</ul>");
    const listBody = html.slice(ulStart, ulEnd);
    const children = listBody.match(/<li[\s>]|<p[\s>]/g) ?? [];
    expect(children.filter((tag) => tag.startsWith("<p"))).toEqual([]);
    expect(children.filter((tag) => tag.startsWith("<li"))).toHaveLength(2);
  });
});