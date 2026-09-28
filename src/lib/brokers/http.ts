/**
 * A response body read with a ceiling.
 *
 * Shared by the broker clients. A report or a page of fills is at most a few
 * megabytes; anything past the cap is not a legitimate answer, and reading it
 * whole first would let a misbehaving upstream exhaust this server's memory.
 * Null means "too large", and each client decides what that is called.
 */
export async function readCappedText(res: Response, maxBytes: number): Promise<string | null> {
  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!res.body) return "";

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
