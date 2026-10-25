"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { tradeScreenshots } from "../db/schema";
import { journalReader } from "./reader";
import { cleanCaption } from "./screenshots";

/**
 * Captioning and deleting the reader's own screenshots. Each looks the
 * screenshot up by its id and the reader's id together, so a guessed id
 * reads the same whether it is somebody else's or does not exist.
 */

export interface ScreenshotResult {
  ok: boolean;
  message: string;
}

function screenshotId(form: FormData): number | null {
  const id = Number(form.get("id"));
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function deleteScreenshot(_prev: ScreenshotResult | null, form: FormData): Promise<ScreenshotResult> {
  const reader = await journalReader();
  if (!reader) return { ok: false, message: "The journal needs an account." };
  const id = screenshotId(form);
  if (id == null) return { ok: false, message: "That screenshot does not exist." };

  const [deleted] = await getDb()
    .delete(tradeScreenshots)
    .where(and(eq(tradeScreenshots.id, id), eq(tradeScreenshots.userId, reader.userId)))
    .returning({ tradeId: tradeScreenshots.tradeId });
  if (!deleted) return { ok: false, message: "That screenshot does not exist." };

  revalidatePath(`/journal/trades/${deleted.tradeId}`);
  return { ok: true, message: "Deleted." };
}

export async function captionScreenshot(_prev: ScreenshotResult | null, form: FormData): Promise<ScreenshotResult> {
  const reader = await journalReader();
  if (!reader) return { ok: false, message: "The journal needs an account." };
  const id = screenshotId(form);
  if (id == null) return { ok: false, message: "That screenshot does not exist." };

  const [updated] = await getDb()
    .update(tradeScreenshots)
    .set({ caption: cleanCaption(form.get("caption")) })
    .where(and(eq(tradeScreenshots.id, id), eq(tradeScreenshots.userId, reader.userId)))
    .returning({ tradeId: tradeScreenshots.tradeId });
  if (!updated) return { ok: false, message: "That screenshot does not exist." };

  revalidatePath(`/journal/trades/${updated.tradeId}`);
  return { ok: true, message: "Saved." };
}
