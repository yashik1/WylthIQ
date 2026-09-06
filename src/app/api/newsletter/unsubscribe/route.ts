import { unsubscribeFromNewsletter } from "@/lib/newsletter/actions";
import { verifyNewsletterToken } from "@/lib/newsletter/token";
import { mailLinkPage } from "@/lib/mail-link-page";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe from the public newsletter.
 *
 * Nothing between the link and the outcome — no confirm button, no sign-in.
 * Making somebody work for this converts unsubscribes into spam reports,
 * which costs the sending domain far more than the subscriber was worth.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const email = token ? verifyNewsletterToken("unsubscribe", token) : null;

  if (!email) {
    return mailLinkPage(
      "That link is not valid",
      "It may have been altered in transit. Reply to any newsletter email and the address will be removed by hand.",
      400,
    );
  }

  if (!(await unsubscribeFromNewsletter(email))) {
    return mailLinkPage(
      "Something went wrong",
      "The subscription could not be stopped just now. Try the link again in a few minutes.",
      500,
    );
  }

  return mailLinkPage(
    "Unsubscribed",
    "You will not receive the newsletter again. If you also have an account here, this does not touch it or the weekly digest of your own saved companies — that one is switched off from your account page.",
    200,
  );
}
