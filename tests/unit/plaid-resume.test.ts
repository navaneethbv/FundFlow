import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveResume, loadResume, clearResume } from "@/lib/plaid-resume";

describe("plaid-resume", () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn((key: string) => store[key] || null),
        setItem: vi.fn((key: string, val: string) => {
          store[key] = val;
        }),
        removeItem: vi.fn((key: string) => {
          delete store[key];
        }),
      },
    });
    for (const key in store) {
      delete store[key];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saves and loads resume info successfully", () => {
    const resumeData = { token: "token123", mode: "connect" as const };
    saveResume(resumeData);
    expect(window.localStorage.setItem).toHaveBeenCalledWith(
      "plaid_link_resume",
      JSON.stringify(resumeData),
    );

    const loaded = loadResume();
    expect(loaded).toEqual(resumeData);
  });

  it("handles reconnect mode successfully", () => {
    const resumeData = {
      token: "token123",
      mode: "reconnect" as const,
      itemId: "item456",
    };
    saveResume(resumeData);
    expect(loadResume()).toEqual(resumeData);
  });

  it("clears resume successfully", () => {
    const resumeData = { token: "token123", mode: "connect" as const };
    saveResume(resumeData);
    expect(loadResume()).not.toBeNull();

    clearResume();
    expect(loadResume()).toBeNull();
  });

  it("handles errors gracefully when localStorage throws", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error("Storage full");
        }),
        setItem: vi.fn(() => {
          throw new Error("Storage full");
        }),
        removeItem: vi.fn(() => {
          throw new Error("Storage full");
        }),
      },
    });

    expect(() => saveResume({ token: "tok", mode: "connect" })).not.toThrow();
    expect(loadResume()).toBeNull();
    expect(() => clearResume()).not.toThrow();
  });
});
