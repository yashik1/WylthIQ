import { aiModel } from "./config";

/**
 * One request to Claude, through the Messages API.
 *
 * Plain fetch rather than an SDK, since this is a single call. Failures come
 * back classified — rate limited, timed out, the provider erring, or a
 * response with no text — so the caller can tell a reader something true,
 * and no failure ever carries the key or the raw provider message.
 */

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export type ClaudeFailure = "NOT_CONFIGURED" | "RATE_LIMITED" | "TIMEOUT" | "PROVIDER_ERROR" | "INVALID_DATA";

export type ClaudeResult =
  | { ok: true; text: string; model: string }
  | { ok: false; kind: ClaudeFailure; status?: number };

export async function callClaude({
  system,
  user,
  maxTokens = 600,
  timeoutMs = 30_000,
}: {
  system: string;
  user: string;
  maxTokens?: number;
  timeoutMs?: number;
}): Promise<ClaudeResult> {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) return { ok: false, kind: "NOT_CONFIGURED" };

  const model = aiModel();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    // 529 is Anthropic's "overloaded", which to a reader is the same as busy.
    if (response.status === 429 || response.status === 529) {
      return { ok: false, kind: "RATE_LIMITED", status: response.status };
    }
    if (!response.ok) return { ok: false, kind: "PROVIDER_ERROR", status: response.status };

    const body = (await response.json().catch(() => null)) as {
      content?: { type?: string; text?: unknown }[];
    } | null;
    const text = Array.isArray(body?.content)
      ? body.content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text as string)
          .join("\n")
          .trim()
      : "";

    return text ? { ok: true, text, model } : { ok: false, kind: "INVALID_DATA" };
  } catch {
    return { ok: false, kind: controller.signal.aborted ? "TIMEOUT" : "PROVIDER_ERROR" };
  } finally {
    clearTimeout(timer);
  }
}
