import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { readFormBody, readJsonBody } from "@/lib/request-body";

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const cancel = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
      else controller.close();
    },
    cancel,
  });
  const request = new Request("http://localhost", {
    method: "POST", body, headers, duplex: "half",
  } as RequestInit);
  return { request, cancel };
}
const encode = (value: string) => new TextEncoder().encode(value);

async function status(value: unknown) {
  expect(value).toBeInstanceOf(NextResponse);
  return (value as NextResponse).status;
}

describe("bounded request parsing", () => {
  it("accepts valid JSON at the exact byte limit including split UTF-8", async () => {
    const bytes = encode('{"question":"café"}');
    const { request } = streamed([bytes.slice(0, 16), bytes.slice(16)]);
    expect(await readJsonBody(request, bytes.length)).toEqual({ question: "café" });
  });

  it.each<Record<string, string>>([{}, { "content-length": "1" }])("bounds actual streamed bytes despite headers %j", async (headers) => {
    const { request, cancel } = streamed(Array.from({ length: 20 }, () => encode("12345")), headers);
    expect(await status(await readJsonBody(request, 10))).toBe(413);
    await vi.waitFor(() => expect(cancel).toHaveBeenCalled());
  });

  it("rejects a declared oversized payload before reading", async () => {
    const { request } = streamed([encode("{}")], { "content-length": "999" });
    expect(await status(await readJsonBody(request, 10))).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });

  it.each(["", "{bad", "undefined"])("rejects invalid JSON %j", async (body) => {
    expect(await status(await readJsonBody(new Request("http://localhost", { method: "POST", body }), 100))).toBe(400);
  });

  it("rejects an absent body", async () => {
    expect(await status(await readJsonBody(new Request("http://localhost"), 100))).toBe(400);
  });

  it("handles a failed stream as malformed input", async () => {
    const body = new ReadableStream({ start(controller) { controller.error(new Error("disconnected")); } });
    const request = new Request("http://localhost", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(await status(await readJsonBody(request, 100))).toBe(400);
  });

  it("preserves multipart fields and file contents", async () => {
    const form = new FormData();
    form.set("merchant", "Cafe");
    form.set("file", new File(["image bytes"], "receipt.png", { type: "image/png" }));
    const result = await readFormBody(new Request("http://localhost", { method: "POST", body: form }), 1024);
    expect(result).toBeInstanceOf(FormData);
    expect((result as FormData).get("merchant")).toBe("Cafe");
    expect(await ((result as FormData).get("file") as File).text()).toBe("image bytes");
  });

  it("bounds the whole multipart envelope including extra fields", async () => {
    const form = new FormData();
    form.set("extra", "x".repeat(4096));
    form.set("file", new File(["small"], "receipt.png"));
    const encoded = new Request("http://localhost", { method: "POST", body: form });
    const { request } = streamed([new Uint8Array(await encoded.arrayBuffer())], { "content-type": encoded.headers.get("content-type")! });
    expect(await status(await readFormBody(request, 1024))).toBe(413);
  });

  it("rejects malformed multipart", async () => {
    expect(await status(await readFormBody(new Request("http://localhost", { method: "POST", body: "bad" }), 100))).toBe(400);
  });
});
