import { expect, type Page } from "@playwright/test";

/**
 * Assert the page cannot be scrolled sideways, and name what is at fault when
 * it can.
 *
 * Two checks, because neither is sufficient alone:
 *
 *   1. **The offender sweep** finds elements escaping the viewport outside a
 *      scroll container. It reports names, which a bare width comparison
 *      cannot. Its blind spot: it exempts anything whose ancestor scrolls, but
 *      a `position: absolute` child is *not* clipped by a `position: static`
 *      scroll container — its containing block is further up. Such an element
 *      escapes and this sweep still calls it contained.
 *   2. **The scroll probe** actually tries to scroll the window right. This is
 *      the real guard, and the only one that catches case (1)'s blind spot. It
 *      caught Recurring's `sr-only` Actions header (Tailwind implements
 *      `sr-only` as `position: absolute`) giving a 390px phone 623px of page
 *      scroll while the sweep reported nothing.
 *
 * `documentElement.scrollWidth > clientWidth`, which most specs here still use,
 * agrees with the scroll probe but names nothing, so a failure tells you the
 * page is broken without telling you where. Note it stays accurate despite
 * `app/globals.css` setting `overflow-x: clip` on `html, body` — that clip does
 * not stop the viewport from scrolling here.
 */
export async function expectNoHorizontalPageScroll(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    // The Next.js dev-tools overlay is ~1000px wide and lives in a shadow root.
    document.querySelectorAll("nextjs-portal").forEach((element) => {
      (element as HTMLElement).style.display = "none";
    });

    const viewportWidth = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.left >= -1 && rect.right <= viewportWidth + 1) return false;
        let parent = element.parentElement;
        while (parent && parent !== document.body) {
          const overflowX = getComputedStyle(parent).overflowX;
          if (["auto", "scroll", "hidden", "clip"].includes(overflowX)) {
            return false;
          }
          parent = parent.parentElement;
        }
        return true;
      })
      .map((element) =>
        `${element.tagName}.${String(element.className)}`.slice(0, 90),
      )
      .slice(0, 6);

    const originalX = window.scrollX;
    window.scrollTo(viewportWidth * 4, window.scrollY);
    const scrolledX = window.scrollX;
    window.scrollTo(originalX, window.scrollY);

    return { offenders, scrolledX };
  });

  expect(
    result.offenders,
    "elements must not escape the viewport outside a scroll container",
  ).toEqual([]);
  expect(result.scrolledX, "page must not scroll horizontally").toBe(0);
}
