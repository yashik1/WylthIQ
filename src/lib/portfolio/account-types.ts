/**
 * The kinds of account a Canadian investor holds shares in.
 *
 * Brokers name them every which way — "TFSA", "ca_tfsa", "Tax-Free Savings
 * Account", "Spousal RRSP", "RSP" — so each source's wording is read into one
 * short list here. A name that does not say is left unknown rather than
 * guessed: the reader sets it once on the account page, and that choice wins
 * over anything detected.
 */

export const ACCOUNT_TYPES = ["TFSA", "RRSP", "FHSA", "RRIF", "RESP", "LOCKED_IN", "NON_REGISTERED", "OTHER"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  TFSA: "TFSA",
  RRSP: "RRSP",
  FHSA: "FHSA",
  RRIF: "RRIF",
  RESP: "RESP",
  LOCKED_IN: "Locked-in (LIRA)",
  NON_REGISTERED: "Non-registered",
  OTHER: "Other",
};

/** What an account with no known type is called wherever types are listed. */
export const UNKNOWN_TYPE = "Type not set";

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === "string" && (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export function accountTypeLabel(type: AccountType | null | undefined): string {
  return type ? ACCOUNT_TYPE_LABELS[type] : UNKNOWN_TYPE;
}

/**
 * Ordered so the specific wins: a locked-in plan before the RRSP it derives
 * from, a RRIF before "retirement", the first-home account before anything
 * that merely mentions savings.
 */
const RULES: [AccountType, RegExp][] = [
  ["LOCKED_IN", /\b(lira|lrsp|lif|lrif|rlif|prif|locked in)\b/],
  ["FHSA", /\b(fhsa|first home savings)\b/],
  ["TFSA", /\b(tfsa|tax free savings)\b/],
  ["RRIF", /\b(rrif|retirement income fund)\b/],
  ["RESP", /\b(resp|education savings)\b/],
  ["RRSP", /\b(rrsp|srrsp|rsp|spousal|retirement savings)\b/],
];

/**
 * Words that mean an ordinary taxable account — but only when the broker
 * itself calls the account that. IBKR, for one, describes a TFSA as a cash
 * "Individual" account, so these are trusted only from sources that name
 * registered accounts separately.
 */
const NON_REGISTERED = /\b(non registered|nonregistered|margin|cash|individual|joint|personal|taxable)\b/;

/**
 * The account type a broker's wording names, or null when it does not.
 *
 * `texts` run from most to least authoritative — the broker's own type field
 * before a name the reader may have chosen — and the first that says anything
 * decides. `plainMeansTaxable` lets ordinary words ("Margin", "Cash") count as
 * non-registered, for sources that are known to name registered accounts.
 */
export function accountTypeFrom(
  texts: (string | null | undefined)[],
  { plainMeansTaxable = false }: { plainMeansTaxable?: boolean } = {},
): AccountType | null {
  for (const text of texts) {
    if (typeof text !== "string") continue;
    const words = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!words) continue;
    for (const [type, pattern] of RULES) if (pattern.test(words)) return type;
    if (plainMeansTaxable && NON_REGISTERED.test(words)) return "NON_REGISTERED";
  }
  return null;
}
