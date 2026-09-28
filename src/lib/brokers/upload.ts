import { and, eq } from "drizzle-orm";
import { getDb } from "../db";
import { brokerConnections } from "../db/schema";
import { duplicateWarning, summarise, type BrokerResult } from "./gate";
import { FLEX_ERROR_WORDS, FlexError, parseFlexReport } from "./ibkr-flex";
import { applyReport, IBKR_UPLOAD } from "./sync";

/**
 * A statement the reader downloaded from IBKR and uploaded here.
 *
 * No credential and no third party: the reader runs their own Flex query in
 * IBKR's portal, downloads the XML, and hands this app the file. It is read,
 * applied like any other report, and not kept — only the holdings and fills
 * taken from it are.
 */

export const MAX_STATEMENT_BYTES = 25 * 1024 * 1024;

export async function ingestStatement(userId: string, xml: string, journalSince: string): Promise<BrokerResult> {
  let report;
  try {
    report = parseFlexReport(xml);
  } catch (err) {
    const category = err instanceof FlexError ? err.category : "INVALID_RESPONSE";
    return {
      ok: false,
      message:
        category === "INVALID_RESPONSE"
          ? "That file is not an IBKR Flex statement in XML. In IBKR, run your Flex query with the format set to XML and upload what it downloads."
          : FLEX_ERROR_WORDS[category],
    };
  }
  if (!report.sections.positions && !report.sections.trades) {
    return {
      ok: false,
      message: "That statement has neither an Open Positions nor a Trades section. Add both to the Flex query and run it again.",
    };
  }

  const db = getDb();
  const [existing] = await db
    .select()
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, userId), eq(brokerConnections.broker, IBKR_UPLOAD)))
    .limit(1);

  // An older file would put back holdings the reader has since sold.
  if (existing?.statementToDate && report.toDate && report.toDate < existing.statementToDate) {
    return {
      ok: false,
      message: `That statement ends on ${report.toDate}, before the one already loaded (${existing.statementToDate}). Upload a newer one.`,
    };
  }

  const notes: string[] = [];
  const warning = existing ? null : await duplicateWarning(userId);
  if (warning) notes.push(warning);

  const now = new Date();
  const [connection] = existing
    ? [existing]
    : await db
        .insert(brokerConnections)
        .values({ userId, broker: IBKR_UPLOAD, journalSince, status: "ok", lastAttemptAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [brokerConnections.userId, brokerConnections.broker],
          set: { lastAttemptAt: now, updatedAt: now },
        })
        .returning();

  try {
    const outcome = await applyReport(connection, report);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      message: `Statement loaded. ${summarise(outcome.positions, outcome.tradesAdded, outcome.tradesUpdated)}.`,
      notes: [...notes, ...outcome.notes],
    };
  } catch (err) {
    console.error("[brokers] applying an uploaded statement failed:", err instanceof Error ? err.name : "unknown");
    return { ok: false, message: "The statement could not be saved. Try again in a few minutes." };
  }
}
