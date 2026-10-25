import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who may add and see a trade's screenshots. The database is stood in for:
 * what is tested is that each route refuses before it reads or writes
 * anything, and answers "not found" for somebody else's trade or image
 * exactly as for one that does not exist.
 */

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/security/guard", () => ({
  refuseIfRateLimited: vi.fn(() => null),
  userRateLimited: vi.fn(() => null),
}));
vi.mock("@/lib/journal/reader", () => ({ journalReader: vi.fn() }));
vi.mock("@/lib/journal/screenshots", async (original) => ({
  ...(await original<typeof import("@/lib/journal/screenshots")>()),
  screenshotCount: vi.fn(),
}));
const rows: unknown[] = [];
const insert = vi.fn();
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
    insert,
  }),
}));

import { journalReader } from "@/lib/journal/reader";
import { screenshotCount } from "@/lib/journal/screenshots";
import { GET } from "./screenshots/[id]/route";
import { POST } from "./trades/[id]/screenshots/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;

function upload(headers: Record<string, string> = {}): Request {
  const body = new FormData();
  body.set("image", new File([new Uint8Array([1, 2, 3])], "chart.png", { type: "image/png" }));
  return new Request("https://wylthiq.example/api/journal/trades/7/screenshots", {
    method: "POST",
    body,
    headers: { origin: "https://wylthiq.example", host: "wylthiq.example", "content-length": "500", ...headers },
  });
}

beforeEach(() => {
  rows.length = 0;
  insert.mockReset();
  vi.mocked(journalReader).mockResolvedValue({ userId: "reader-a" });
  vi.mocked(screenshotCount).mockResolvedValue(0);
});

describe("adding a screenshot", () => {
  it("refuses a post from another site", async () => {
    const res = await POST(upload({ origin: "https://elsewhere.example" }), ctx("7"));
    expect(res.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a reader who is not signed in", async () => {
    vi.mocked(journalReader).mockResolvedValue(null);
    expect((await POST(upload(), ctx("7"))).status).toBe(401);
  });

  it("answers not found for somebody else's trade, as for one that does not exist", async () => {
    vi.mocked(screenshotCount).mockResolvedValue(null);
    const res = await POST(upload(), ctx("7"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, message: "That trade does not exist." });
    expect(screenshotCount).toHaveBeenCalledWith(7, "reader-a");
  });

  it("stops at six per trade", async () => {
    vi.mocked(screenshotCount).mockResolvedValue(6);
    expect((await POST(upload(), ctx("7"))).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it("refuses a body declared over the limit before reading it", async () => {
    expect((await POST(upload({ "content-length": String(20 * 1024 * 1024) }), ctx("7"))).status).toBe(413);
  });

  it("keeps nothing that is not an image", async () => {
    const res = await POST(upload(), ctx("7"));
    expect(res.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("seeing a screenshot", () => {
  it("is not found without a reader, or when the image is not theirs", async () => {
    vi.mocked(journalReader).mockResolvedValue(null);
    expect((await GET(new Request("https://wylthiq.example/x"), ctx("3"))).status).toBe(404);

    vi.mocked(journalReader).mockResolvedValue({ userId: "reader-b" });
    expect((await GET(new Request("https://wylthiq.example/x"), ctx("3"))).status).toBe(404);
  });

  it("serves the owner's image as WebP that the browser may not reinterpret", async () => {
    rows.push({ image: Buffer.from([0x52, 0x49, 0x46, 0x46]) });
    const res = await GET(new Request("https://wylthiq.example/x"), ctx("3"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/webp");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toMatch(/^private/);
  });
});
