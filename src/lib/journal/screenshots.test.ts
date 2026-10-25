import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { cleanCaption, processScreenshot } from "./screenshots";

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } } });

describe("keeping a reader's screenshot", () => {
  it("re-encodes a PNG, JPEG or WebP as WebP", async () => {
    for (const input of [
      await solid(800, 500).png().toBuffer(),
      await solid(800, 500).jpeg().toBuffer(),
      await solid(800, 500).webp().toBuffer(),
    ]) {
      const result = await processScreenshot(input);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect((await sharp(result.image).metadata()).format).toBe("webp");
      expect([result.width, result.height]).toEqual([800, 500]);
    }
  });

  it("drops the location and camera details a photo carries", async () => {
    const photo = await solid(400, 300)
      .withExifMerge({ IFD0: { Make: "PhoneCo", Model: "Snapper 9" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "43/1 39/1 0/1" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(photo).metadata()).exif).toBeDefined();
    const result = await processScreenshot(photo);
    expect(result.ok).toBe(true);
    if (result.ok) expect((await sharp(result.image).metadata()).exif).toBeUndefined();
  });

  it("scales a very large image down to fit", async () => {
    const result = await processScreenshot(await solid(5000, 2500).png().toBuffer());
    expect(result.ok && [result.width, result.height]).toEqual([2000, 1000]);
  });

  it("refuses an SVG, which can carry script, and says what to use instead", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>',
    );
    expect(await processScreenshot(svg)).toEqual({ ok: false, message: expect.stringMatching(/SVG/) });
  });

  it("refuses a GIF, and anything that is not an image at all", async () => {
    expect(await processScreenshot(await solid(10, 10).gif().toBuffer())).toEqual({
      ok: false,
      message: expect.stringMatching(/GIF/),
    });
    expect((await processScreenshot(Buffer.from("<html>not a picture</html>"))).ok).toBe(false);
    expect(await processScreenshot(new Uint8Array())).toEqual({ ok: false, message: "Choose an image to upload." });
  });

  it("refuses a file over the upload limit before decoding it", async () => {
    const result = await processScreenshot(new Uint8Array(10 * 1024 * 1024 + 1));
    expect(result).toEqual({ ok: false, message: expect.stringMatching(/10 MB/) });
  });
});

describe("a screenshot's caption", () => {
  it("is trimmed to one line and bounded", () => {
    expect(cleanCaption("  breakout \n\n over the   high ")).toBe("breakout over the high");
    expect(cleanCaption("x".repeat(500))).toHaveLength(200);
    expect(cleanCaption(null)).toBe("");
  });
});
