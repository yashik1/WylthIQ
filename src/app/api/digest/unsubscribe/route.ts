import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyUnsubscribeToken } from "@/lib/digest/token";
import { mailLinkPage } from "@/lib/mail-link-page";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe.
 *
 * Answers HTML rather than JSON: this URL is opened by a person clicking a
 * link in an email client, not by a script, and a page of JSON reads as a
 * failure to somebody who just wanted the mail to stop.
 *
 * Accepts GET, which is unusual for a state change and correct here. Mail
 * clients and their link scanners issue GETs, and the alternative — a landing
 * page with a confirm button — is one more thing between a person and the
 * outcome they already asked for. The token's authority is narrow enough for
 * that to be safe: it turns off one flag on one account and can do nothing
 * else, so a scanner following it costs somebody a digest they can switch
 * back on, not access to anything.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const userId = token ? verifyUnsubscribeToken(token) : null;

  if (!userId) {
    return mailLinkPage(
      "That link is not valid",
      "It may have been altered in transit. You can turn the weekly digest off from your account page at any time.",
      400,
    );
  }

  if (!isDatabaseConfigured()) {
    return mailLinkPage(
      "Not available right now",
      "This deployment has no database configured, so the setting could not be changed.",
      503,
    );
  }

  try {
    await getDb().update(users).set({ digestOptIn: false }).where(eq(users.id, userId));
  } catch {
    return mailLinkPage(
      "Something went wrong",
      "The setting could not be changed just now. You can also turn the digest off from your account page.",
      500,
    );
  }

  return mailLinkPage(
    "Unsubscribed",
    "You will not receive the weekly digest again. Your account and your saved companies are untouched — you can turn it back on from your account page whenever you like.",
    200,
  );
}
