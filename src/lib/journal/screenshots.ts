import sharp from "sharp";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "../db";
import { trades, tradeScreenshots } from "../db/schema";

/**
 * A reader's own screenshots of a trade.
 *
 * Every upload is decoded and re-encoded as WebP before it is kept, never
 * stored as sent. That one step does the security work: only real PNG, JPEG
 * and WebP images get through (decided by their content, not their name), an
 * SVG with script in it or a file that is two formats at once does not
 * survive the round trip, and the location and camera details a phone writes
 * into a photo are dropped. It also keeps each one small enough to sit in
 * Postgres: a full-screen chart comes out at a few hundred kilobytes.
 */

/** What may be sent. A phone's full-resolution screenshot is well under this. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** What may be kept, after re-encoding. */
export const MAX_STORED_BYTES = 1_500_000;
export const MAX_PER_TRADE = 6;
export const MAX_CAPTION = 200;
/** Wider than any screen; larger images are scaled down to it. */
const MAX_SIDE = 2_000;
/** Refuses a small file that would decode into a huge image. */
const MAX_INPUT_PIXELS = 50_000_000;

const ACCEPTED = new Set(["png", "jpeg", "webp"]);

export type Processed =
  | { ok: true; image: Buffer; width: number; height: number }
  | { ok: false; message: string };

function refusalFor(format: string | undefined): string {
  switch (format) {
    case "svg":
      return "SVG files are not accepted. Save the chart as a PNG or JPEG.";
    case "heif":
      return "HEIC photos are not accepted. Take a screenshot (PNG) or save it as JPEG.";
    case "gif":
      return "GIFs are not accepted. Save it as a PNG or JPEG.";
    default:
      return "That file is not an image this can read. Use a PNG, JPEG or WebP.";
  }
}

/** Decodes an upload and re-encodes it for keeping, or says why not. */
export async function processScreenshot(input: Uint8Array): Promise<Processed> {
  if (input.byteLength === 0) return { ok: false, message: "Choose an image to upload." };
  if (input.byteLength > MAX_UPLOAD_BYTES) return { ok: false, message: "That image is too large. The limit is 10 MB." };

  let format: string | undefined;
  try {
    ({ format } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata());
  } catch {
    return { ok: false, message: refusalFor(undefined) };
  }
  if (!format || !ACCEPTED.has(format)) return { ok: false, message: refusalFor(format) };

  try {
    for (const quality of [80, 60]) {
      const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
        // Turned the way the camera held it, before the orientation tag is dropped.
        .rotate()
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
        .webp({ quality })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= MAX_STORED_BYTES) return { ok: true, image: data, width: info.width, height: info.height };
    }
  } catch {
    return { ok: false, message: "That image could not be read. It may be damaged; try saving it again." };
  }
  return { ok: false, message: "That image is too detailed to keep. Try a smaller screenshot." };
}

/** How many screenshots the reader's own trade has, or null when it is not theirs. */
export async function screenshotCount(tradeId: number, userId: string): Promise<number | null> {
  const db = getDb();
  const [owned] = await db
    .select({ id: trades.id })
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
    .limit(1);
  if (!owned) return null;
  const [row] = await db
    .select({ n: count() })
    .from(tradeScreenshots)
    .where(and(eq(tradeScreenshots.tradeId, tradeId), eq(tradeScreenshots.userId, userId)));
  return row?.n ?? 0;
}

/** A caption as typed, trimmed and bounded. */
export function cleanCaption(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_CAPTION);
}
