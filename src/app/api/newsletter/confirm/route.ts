import { confirmSubscription } from "@/lib/newsletter/actions";
import { verifyNewsletterToken } from "@/lib/newsletter/token";
import { mailLinkPage } from "@/lib/mail-link-page";

export const dynamic = "force-dynamic";

/**
 * The click that turns a submitted address into a subscriber.
 *
 * Answers HTML rather than JSON, for the same reason the digest unsubscribe
 * does: a person opened this from an email client, and a page of JSON reads
 * as a failure to somebody who just wanted to confirm.
 *
 * GET, and a state change, which is the right trade here as it is there. The
 * token's authority is exactly one thing — add this address to a newsletter —
 * so a mail client's link scanner following it early costs somebody a
 * subscription they asked for and can leave in one click.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = token ? verifyNewsletterToken("confirm", token) : null;

  if (!email) {
    return mailLinkPage(
      "That link is not valid",
      "It may have been altered in transit, or it may be an unsubscribe link rather than a confirmation. Sign up again from the site and a fresh one will be sent.",
      400,
    );
  }

  if (!(await confirmSubscription(email))) {
    return mailLinkPage(
      "Something went wrong",
      "Your subscription could not be confirmed just now. Try the link again in a few minutes.",
      500,
    );
  }

  return mailLinkPage(
    "You are subscribed",
    "You will get the weekly newsletter: what the companies in our scored universe actually filed that week, taken from their SEC filings. Every email carries a one-click unsubscribe link.",
    200,
  );
}
