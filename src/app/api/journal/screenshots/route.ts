import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { tradeScreenshots } from "@/lib/db/schema";
import { journalReader } from "@/lib/journal/reader";
import {
  cleanCaption,
  MAX_PER_TRADE,
  MAX_UPLOAD_BYTES,
  processScreenshot,
  screenshotCount,
} from "@/lib/journal/screenshots";
import { refuseIfRateLimited, userRateLimited } from "@/lib/security/guard";

export const dynamic = "force-dynamic";

/**
 * Adds one of the reader's own screenshots to one of their trades.
 *
 * A route rather than a server action because a phone screenshot can pass
 * the 1 MB that server actions accept. It acts on the signed-in reader's
 * journal, so it takes the guard a server action gets for free: the request
 * must come from this site's own pages.
 *
 * The trade is named in the form rather than the path, so the page posts to
 * one fixed address and no request URL is ever built from a value.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ ok: false, message: "Upload from the trade's page." }, { status: 403 });
  }

  const refusal = refuseIfRateLimited(request, "journalUpload");
  if (refusal) return refusal;

  const reader = await journalReader();
  if (!reader) return NextResponse.json({ ok: false, message: "The journal needs an account." }, { status: 401 });
  const wait = userRateLimited("journalUpload", reader.userId);
  if (wait) {
    return NextResponse.json(
      { ok: false, message: `Too many uploads. Try again in ${Math.ceil(wait / 60)} minutes.` },
      { status: 429 },
    );
  }

  // Checked before reading, with room for the form's own framing.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, message: "That image is too large. The limit is 10 MB." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const tradeId = Number(form?.get("tradeId"));
  const existing = Number.isInteger(tradeId) && tradeId > 0 ? await screenshotCount(tradeId, reader.userId) : null;
  // The same answer whether the trade is somebody else's or does not exist.
  if (!form || existing === null) {
    return NextResponse.json({ ok: false, message: "That trade does not exist." }, { status: 404 });
  }
  if (existing >= MAX_PER_TRADE) {
    return NextResponse.json(
      { ok: false, message: `A trade can have ${MAX_PER_TRADE} screenshots. Delete one to add another.` },
      { status: 400 },
    );
  }

  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, message: "Choose an image to upload." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ ok: false, message: "That image is too large. The limit is 10 MB." }, { status: 413 });
  }

  const processed = await processScreenshot(new Uint8Array(await file.arrayBuffer()));
  if (!processed.ok) return NextResponse.json(processed, { status: 400 });

  const [saved] = await getDb()
    .insert(tradeScreenshots)
    .values({
      tradeId,
      userId: reader.userId,
      image: processed.image,
      width: processed.width,
      height: processed.height,
      bytes: processed.image.length,
      caption: cleanCaption(form.get("caption")),
    })
    .returning({
      id: tradeScreenshots.id,
      width: tradeScreenshots.width,
      height: tradeScreenshots.height,
      bytes: tradeScreenshots.bytes,
      caption: tradeScreenshots.caption,
      createdAt: tradeScreenshots.createdAt,
    });

  revalidatePath(`/journal/trades/${tradeId}`);
  return NextResponse.json({
    ok: true,
    message: "Screenshot added.",
    screenshot: { ...saved, createdAt: saved.createdAt.toISOString() },
  });
}
