import { NextResponse } from "next/server";
import { refuseUnauthorizedCron } from "@/lib/security/cron-auth";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { runDigest } from "@/lib/digest/send";

export const dynamic = "force-dynamic";

/**
 * The weekly digest run.
 *
 * Authenticated with the same shared secret as the other cron routes. This
 * one matters more than they do: the others burn an API quota if abused,
 * while this one sends mail to real people, so an unauthenticated call is a
 * way to use this deployment to spam its own users.
 *
 * Defaults to a **dry run**. Pass `?send=1` to actually deliver. That is the
 * wrong way round for convenience and the right way round for a route whose
 * mistake is irreversible — an email cannot be recalled, and the failure mode
 * of "curl it to see what it does" should not be a mailshot.
 */
export async function GET(request: Request) {
  /*
    The same fail-closed gate the other two cron routes now use.

    This route argued the case first — an email cannot be recalled, so it
    refused to run without a secret while the others waved it through. That
    asymmetry is gone: burning somebody else's API quota turned out to be
    worth refusing too, so the reasoning moved into one shared helper.
  */
  const refusal = refuseUnauthorizedCron(request) ?? refuseIfRateLimited(request, "cron");
  if (refusal) return refusal;

  const params = new URL(request.url).searchParams;
  const send = params.get("send") === "1";
  const limitRaw = Number(params.get("limit"));
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : undefined;

  try {
    const result = await runDigest({ dryRun: !send, limit });
    return NextResponse.json(
      {
        ...result,
        note: send
          ? "Live run. Recipients past their gap with something to report were emailed."
          : "Dry run — nothing was sent. Add ?send=1 to deliver.",
      },
      { status: result.ok ? 200 : 503 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Digest run failed";
    return NextResponse.json({ ok: false, error: "digest-failed", message }, { status: 500 });
  }
}
