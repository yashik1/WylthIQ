import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { tradeScreenshots } from "@/lib/db/schema";
import { journalReader } from "@/lib/journal/reader";

export const dynamic = "force-dynamic";

/** Not found, for a screenshot that is somebody else's as much as one that does not exist. */
function missing(): Response {
  return new Response("Not found", { status: 404, headers: { "Cache-Control": "private, no-store" } });
}

/**
 * One of the reader's own screenshots, to its owner only.
 *
 * Always WebP, because every upload was re-encoded to it. `nosniff` keeps
 * the browser from treating the bytes as anything but an image (the site's
 * own Content-Security-Policy, from next.config.ts, rides on top), and a
 * screenshot never changes once kept, so the browser may keep it as long as
 * it likes — privately, never in a shared cache.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/journal/screenshots/[id]">) {
  const reader = await journalReader();
  if (!reader) return missing();

  const { id } = await ctx.params;
  const screenshotId = Number(id);
  if (!Number.isInteger(screenshotId) || screenshotId <= 0) return missing();

  const [row] = await getDb()
    .select({ image: tradeScreenshots.image })
    .from(tradeScreenshots)
    .where(and(eq(tradeScreenshots.id, screenshotId), eq(tradeScreenshots.userId, reader.userId)))
    .limit(1);
  if (!row) return missing();

  return new Response(new Uint8Array(row.image), {
    headers: {
      "Content-Type": "image/webp",
      "Content-Length": String(row.image.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
