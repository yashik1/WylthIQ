/**
 * The questions a reader can ask about a company's figures.
 *
 * A fixed list rather than a text box. Free-form questions turn a grounded
 * explanation into a general chatbot, invite "should I buy this", and open the
 * prompt to whatever a reader types. Each of these can be answered from the
 * figures on the page alone.
 */

export const AI_QUESTIONS = {
  "health-change": {
    label: "Why did the health score change?",
    instruction:
      "Explain how the health score moved across the years in the health score history, and which of the scored areas the facts show changing. If there is no history, say that, and describe what the current score rests on instead.",
  },
  "what-changed": {
    label: "What changed in the latest figures?",
    instruction:
      "Summarise the largest changes between the two latest annual reports, and the latest quarter where one is given, starting with the most significant. Give the before and after figures.",
  },
  "closer-look": {
    label: "Which figures are worth a closer look?",
    instruction:
      "Name the figures a careful reader would examine further, drawing only on the facts: weak or mixed ratings, large moves, model flags, and figures that were not reported. Say what each is, not what caused it.",
  },
  valuation: {
    label: "What do the valuation figures measure?",
    instruction:
      "Explain what each valuation figure given measures, what it compares, and what it cannot say about the business. Do not call the share price high, low, cheap or expensive in any sense beyond what the facts state.",
  },
} as const;

export type AiQuestionKey = keyof typeof AI_QUESTIONS;

export function isAiQuestion(value: unknown): value is AiQuestionKey {
  return typeof value === "string" && Object.hasOwn(AI_QUESTIONS, value);
}

export const AI_QUESTION_OPTIONS: { key: AiQuestionKey; label: string }[] = (
  Object.keys(AI_QUESTIONS) as AiQuestionKey[]
).map((key) => ({ key, label: AI_QUESTIONS[key].label }));
