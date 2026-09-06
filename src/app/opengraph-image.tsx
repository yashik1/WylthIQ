import { ImageResponse } from "next/og";
import { Disclaimer, Eyebrow, Frame, OG, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

export const alt =
  "WylthIQ — company financials in plain English, from regulatory filings";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

/** The card any page without one of its own falls back to. */
export default async function Image() {
  return new ImageResponse(
    (
      <Frame>
        <div style={{ display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between" }}>
          <Eyebrow>WylthIQ</Eyebrow>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 82, fontWeight: 700, lineHeight: 1.05 }}>
              Company financials
            </div>
            <div style={{ display: "flex", fontSize: 82, fontWeight: 700, lineHeight: 1.05, color: OG.accent }}>
              in plain English
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 30, color: OG.muted, maxWidth: 820 }}>
              Is it profitable, growing, or drowning in debt? Answered from the
              filings, with every figure traced back to its source.
            </div>
          </div>

          <Disclaimer />
        </div>
      </Frame>
    ),
    size,
  );
}
