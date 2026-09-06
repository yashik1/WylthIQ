import { ImageResponse } from "next/og";
import { eq } from "drizzle-orm";
import { Disclaimer, Eyebrow, Frame, OG, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { companies, scores } from "@/lib/db/schema";
import { displayName } from "@/lib/company-name";
import { ASSET_CLASS_LABEL, findInstrument } from "@/lib/instruments";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export const alt = "Financial health at a glance, from the company's own filings";

/**
 * The share card for one company.
 *
 * Carries the health score, the company's name and the one-sentence verdict —
 * every one of which is computed from SEC filings, which are public domain.
 *
 * It deliberately carries **no price**. An Open Graph image is a static asset
 * served onward to Facebook, X and Discord, which is redistribution rather
 * than display, and the free price tiers this app runs on do not permit that.
 * The same line is what keeps quotes out of the email digest.
 *
 * Reads the precomputed `scores` row rather than recomputing anything: one
 * indexed lookup, no external call, and it is the same cached verdict the
 * screener and the dashboard already show.
 */
async function loadCard(symbol: string): Promise<{
  score: number | null;
  headline: string | null;
  fiscalYear: number | null;
} | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await getDb()
      .select({
        score: scores.healthScore,
        headline: scores.headline,
        fiscalYear: scores.fiscalYear,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(eq(companies.symbol, symbol))
      .limit(1);
    return row ?? null;
  } catch {
    // A share card is not worth a 500. Fall through to the plain version.
    return null;
  }
}

function toneFor(score: number | null): string {
  if (score == null) return OG.faint;
  if (score >= 7.5) return OG.good;
  if (score >= 5) return OG.fair;
  return OG.poor;
}

function verdictWord(score: number | null): string {
  if (score == null) return "Not enough reported";
  if (score >= 7.5) return "Financially strong";
  if (score >= 5) return "A mixed picture";
  return "Financially weak";
}

export default async function Image({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const upper = decodeURIComponent(symbol).toUpperCase();

  const instrument = findInstrument(upper);
  const [name, card] = await Promise.all([
    displayName(upper).catch(() => null),
    instrument ? Promise.resolve(null) : loadCard(upper),
  ]);

  const heading = name ?? upper;

  /*
    Three states, not two.

    A row with a score shows it. A row whose score is null means the company
    filed too little to judge, which is a fact about the company and worth
    saying. **No row at all** means this symbol has never been through the
    ingest — most of EDGAR has not — and printing "not enough reported" there
    would be a statement about the company that is simply false. The same
    distinction the compare table already draws between "not reported" and
    "n/a", applied here.
  */
  const scored = card !== null;
  // Two lines of headline at 30px is the most that fits without the block
  // colliding with the disclaimer.
  const headline = card?.headline ?? null;
  const fallbackLine = instrument
    ? "Price history and backtesting. It files no accounts, so the company health scores do not apply."
    : "Is it profitable, growing, or carrying too much debt? Answered from its regulatory filings.";

  return new ImageResponse(
    (
      <Frame>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            height: "100%",
            justifyContent: "space-between",
          }}
        >
          <Eyebrow>
            {instrument
              ? `WylthIQ · ${ASSET_CLASS_LABEL[instrument.assetClass]}`
              : "WylthIQ · From the filings"}
          </Eyebrow>

          <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
            <div style={{ display: "flex", flexDirection: "column", flex: 1, paddingRight: 48 }}>
              <div
                style={{
                  display: "flex",
                  fontSize: heading.length > 26 ? 58 : 74,
                  fontWeight: 700,
                  lineHeight: 1.05,
                }}
              >
                {heading}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 12,
                  fontSize: 30,
                  letterSpacing: 4,
                  fontWeight: 600,
                  color: OG.accent,
                }}
              >
                {upper}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 26,
                  fontSize: 30,
                  color: OG.muted,
                  maxWidth: scored ? 620 : 900,
                }}
              >
                {headline ?? fallbackLine}
              </div>
            </div>

            {/* The score, when this symbol has actually been scored. A
                commodity has no company behind it and an un-ingested ticker
                has no verdict yet; in both cases the block is absent rather
                than dashed, because an empty gauge claims data failed to
                load. */}
            {scored && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 268,
                  height: 268,
                  border: `2px solid ${toneFor(card?.score ?? null)}`,
                  backgroundColor: OG.surface,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: 108,
                    fontWeight: 700,
                    lineHeight: 1,
                    color: toneFor(card?.score ?? null),
                  }}
                >
                  {card?.score != null ? card.score.toFixed(1) : "—"}
                </div>
                <div style={{ display: "flex", marginTop: 10, fontSize: 22, letterSpacing: 2, color: OG.faint }}>
                  OUT OF 10
                </div>
                <div style={{ display: "flex", marginTop: 16, fontSize: 22, color: OG.muted }}>
                  {verdictWord(card?.score ?? null)}
                </div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {card?.fiscalYear != null && (
              <div style={{ display: "flex", fontSize: 20, color: OG.faint, marginBottom: 8 }}>
                From its FY{card.fiscalYear} annual filing with the SEC.
              </div>
            )}
            <Disclaimer />
          </div>
        </div>
      </Frame>
    ),
    size,
  );
}
