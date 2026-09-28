import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { brokerReader, denied, journalSinceFrom } from "@/lib/brokers/gate";
import { ingestStatement, MAX_STATEMENT_BYTES } from "@/lib/brokers/upload";
import { refuseIfRateLimited, userRateLimited } from "@/lib/security/guard";

export const dynamic = "force-dynamic";

/**
 * Takes a statement file the reader downloaded from IBKR.
 *
 * A route rather than a server action because a year of statements can pass
 * the 1 MB that server actions accept, and raising that limit would raise it
 * for every action in the app.
 *
 * It acts on the signed-in reader's account, so it takes the same guard a
 * server action gets for free: the request must come from this site's own
 * pages. A form on any other site posting here is refused before the body is
 * read.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) {
    return NextResponse.json({ ok: false, message: "Upload from the account page." }, { status: 403 });
  }

  const refusal = refuseIfRateLimited(request, "brokerUpload");
  if (refusal) return refusal;

  const gate = await brokerReader(true);
  if (denied(gate)) return NextResponse.json(gate, { status: 401 });
  const wait = userRateLimited("brokerUpload", gate.userId);
  if (wait) {
    return NextResponse.json(
      { ok: false, message: `Too many uploads. Try again in ${Math.ceil(wait / 60)} minutes.` },
      { status: 429 },
    );
  }

  // Checked before reading, with room for the form's own framing.
  const declared = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declared) || declared > MAX_STATEMENT_BYTES + 64 * 1024) {
    return NextResponse.json({ ok: false, message: "That file is too large. The limit is 25 MB." }, { status: 413 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("statement");
  if (!form || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ ok: false, message: "Choose the statement file to upload." }, { status: 400 });
  }
  if (file.size > MAX_STATEMENT_BYTES) {
    return NextResponse.json({ ok: false, message: "That file is too large. The limit is 25 MB." }, { status: 413 });
  }

  const result = await ingestStatement(gate.userId, await file.text(), journalSinceFrom(form));
  if (result.ok) {
    revalidatePath("/account");
    revalidatePath("/portfolio");
    revalidatePath("/journal");
  }
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
