import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBlob } from "@/lib/browser-download";

describe("downloadBlob", () => {
  const originalDocument = globalThis.document;
  const originalURL = globalThis.URL;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.URL = originalURL;
  });

  it("creates object url and triggers anchor click and revocation", () => {
    const clickSpy = vi.fn();
    const removeSpy = vi.fn();
    const anchor = {
      href: "",
      download: "",
      click: clickSpy,
      remove: removeSpy,
    };

    globalThis.document = {
      createElement: vi.fn((tag: string) => (tag === "a" ? anchor : {})) as never,
      body: { appendChild: vi.fn() } as never,
    } as never;

    const createObjectURL = vi.fn(() => "blob:http://localhost/test");
    const revokeObjectURL = vi.fn();
    globalThis.URL = {
      ...originalURL,
      createObjectURL,
      revokeObjectURL,
    } as never;

    const blob = new Blob(["hello"], { type: "text/plain" });
    downloadBlob(blob, "hello.txt");

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe("hello.txt");
    expect(anchor.href).toBe("blob:http://localhost/test");
    expect(clickSpy).toHaveBeenCalled();
    expect(removeSpy).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test");
  });
});
