import "server-only";
import sharp, { type Metadata } from "sharp";

export const MAX_RECEIPT_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_FORMATS = new Map([
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export interface NormalizedReceiptImage {
  buffer: Buffer;
  contentType: "image/jpeg";
  extension: "jpg";
  width: number;
  height: number;
}

export async function normalizeReceiptImage(
  file: File,
): Promise<NormalizedReceiptImage> {
  if (file.size > MAX_RECEIPT_IMAGE_BYTES) {
    throw new Error("image_too_large");
  }
  const declaredFormat = MIME_FORMATS.get(file.type);
  if (!declaredFormat) throw new Error("unsupported_image_type");

  const input = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    }).metadata();
  } catch {
    throw new Error("invalid_image");
  }
  if (!metadata.format || metadata.format !== declaredFormat) {
    throw new Error("image_type_mismatch");
  }

  try {
    const { data, info } = await sharp(input, {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      buffer: data,
      contentType: "image/jpeg",
      extension: "jpg",
      width: info.width,
      height: info.height,
    };
  } catch {
    throw new Error("invalid_image");
  }
}
