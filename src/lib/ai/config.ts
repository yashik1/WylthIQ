/**
 * Whether grounded explanations are switched on, and which model writes them.
 *
 * Off unless an operator sets ANTHROPIC_API_KEY. The feature costs money per
 * answer, so it is never on by accident, and every page that offers it checks
 * here first.
 */

export const DEFAULT_AI_MODEL = "claude-opus-5";

export function isAiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function aiModel(): string {
  const configured = process.env.ANTHROPIC_MODEL?.trim();
  return configured && /^[a-z0-9.-]+$/i.test(configured) ? configured : DEFAULT_AI_MODEL;
}
