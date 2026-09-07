/**
 * RFC 9116 security.txt.
 *
 * A route rather than a static file because the expiry has to stay in the
 * future to remain valid, and a hardcoded date in `public/` is one nobody
 * remembers to update — it would sit there expired, which is worse than
 * absent. Computed a year out from the request instead.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);

  const body = [
    "Contact: mailto:security@wylthiq.com",
    `Expires: ${expires.toISOString()}`,
    "Preferred-Languages: en",
    "Canonical: https://wylthiq.com/.well-known/security.txt",
    "Policy: https://github.com/yashik1/WylthIQ/blob/main/SECURITY.md",
    "",
  ].join("\n");

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
