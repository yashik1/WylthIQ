"use server";

import { getEntitlement } from "../billing/entitlement";
import { limit } from "../security/rate-limit";
import { actionRateLimited, RULES } from "../security/guard";
import { getStockPageData } from "../stock-data";
import { buildChangeReport } from "../scoring/changes";
import { buildHealthHistory } from "../scoring/health-history";
import { buildKeyFigures } from "../scoring/key-figures";
import { callClaude, type ClaudeFailure } from "./anthropic";
import { aiModel, isAiConfigured } from "./config";
import { buildGrounding, buildUserMessage, screenAnswer, SYSTEM_PROMPT, type GroundingSource } from "./grounding";
import { isAiQuestion } from "./questions";

/**
 * A grounded explanation of one company's figures, for a signed-in reader.
 *
 * The answer is built only from the figures the company page shows, cites
 * them, and is withheld if it reads as advice. It is cached per company,
 * question and filing, so the same question about the same annual report is
 * paid for once, and limited per address and per account.
 */

export interface AskResult {
  ok: boolean;
  message?: string;
  answer?: string;
  sources?: GroundingSource[];
  model?: string;
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; result: AskResult }>();

const FAILURE_MESSAGE: Record<ClaudeFailure, string> = {
  NOT_CONFIGURED: "Explanations are not switched on for this site.",
  RATE_LIMITED: "The explanation service is busy. Try again in a minute.",
  TIMEOUT: "The explanation took too long. Try again.",
  PROVIDER_ERROR: "Could not get an explanation just now.",
  INVALID_DATA: "Could not get an explanation just now.",
};

export async function askAboutCompany(symbol: string, question: string): Promise<AskResult> {
  if (!isAiConfigured()) return { ok: false, message: FAILURE_MESSAGE.NOT_CONFIGURED };
  if (!isAiQuestion(question)) return { ok: false, message: "That is not one of the questions offered." };

  const clean = typeof symbol === "string" ? symbol.trim().toUpperCase() : "";
  if (!/^[A-Z0-9.\-]{1,20}$/.test(clean)) return { ok: false, message: "That is not a symbol." };

  const entitlement = await getEntitlement();
  if (!entitlement.userId) return { ok: false, message: "Sign in to ask about a company's figures." };

  const wait = await actionRateLimited("ai");
  if (wait != null) return { ok: false, message: `Wait ${wait}s and try again.` };
  const daily = limit(`ai-user:${entitlement.userId}`, RULES.aiDaily);
  if (!daily.ok) return { ok: false, message: "You have asked for many explanations today. Try again tomorrow." };

  const data = await getStockPageData(clean);
  const { fundamentals, report } = data;
  const latest = fundamentals?.annual[0];
  if (!fundamentals || !report || !latest) {
    return { ok: false, message: "There are no filed figures to explain for this company." };
  }

  const key = `${clean}:${question}:${latest.fiscalYear}:${latest.filedAt ?? ""}:${aiModel()}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const currency = data.displayCurrency;
  const grounding = buildGrounding({
    symbol: clean,
    name: data.profile?.name ?? fundamentals.entityName,
    currency,
    latest: {
      fiscalYear: latest.fiscalYear,
      form: latest.form,
      filedAt: latest.filedAt,
      url: report.sourceFilingUrl,
    },
    report,
    changes: buildChangeReport(fundamentals, currency),
    keyFigures: buildKeyFigures(fundamentals, data.marketCap),
    history: buildHealthHistory(fundamentals, data.sector),
    price: data.quote ? { freshness: data.quote.freshness, marketCap: data.marketCap } : null,
  });

  const response = await callClaude({
    system: SYSTEM_PROMPT,
    user: buildUserMessage(question, grounding),
    maxTokens: 600,
  });
  if (!response.ok) return { ok: false, message: FAILURE_MESSAGE[response.kind] };

  const screened = screenAnswer(response.text);
  if (!screened.ok) {
    return {
      ok: false,
      message: "The explanation was withheld because it strayed from describing the figures. Try another question.",
    };
  }

  const result: AskResult = { ok: true, answer: screened.text, sources: grounding.sources, model: response.model };
  cache.set(key, { at: Date.now(), result });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return result;
}
