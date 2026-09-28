import "server-only";
import { NextResponse } from "next/server";

class PayloadTooLarge extends Error {}

/** Bound bytes before JSON or multipart parsing, including chunked requests. */
async function readBody<T>(
  request: Request,
  maxBytes: number,
  parse: (response: Response) => Promise<T>,
): Promise<T | NextResponse> {
  if (Number(request.headers.get("content-length")) > maxBytes) {
    return NextResponse.json({ error: "Payload exceeds maximum size" }, { status: 413 });
  }
  let bytes = 0;
  const bounded = request.body?.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) throw new PayloadTooLarge();
      controller.enqueue(chunk);
    },
  }));
  try {
    return await parse(new Response(bounded, { headers: request.headers }));
  } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return NextResponse.json({ error: "Payload exceeds maximum size" }, { status: 413 });
    }
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
}

export function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  return readBody(request, maxBytes, (response) => response.json());
}

export function readFormBody(request: Request, maxBytes: number): Promise<FormData | NextResponse> {
  return readBody(request, maxBytes, (response) => response.formData());
}
