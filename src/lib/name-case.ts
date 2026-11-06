/**
 * Company names, cased the way people write them.
 *
 * The SEC's files are inconsistent — "Apple Inc." sits beside "MICROSOFT
 * CORP" — and a page title or a link that shouts looks like a rendering fault.
 * Shared by the ticker lookup (sec-edgar.ts) and the page titles
 * (page-title.ts), so a name is cased the same way wherever it appears.
 */

/**
 * Short tokens that are ordinary words rather than initialisms.
 *
 * The default for a two- or three-letter token in a registrant name is that
 * it is an acronym — AMC, PNC, CSX, IBM, TJX, RTX — so the rule below keeps
 * those in capitals and this list carries the exceptions. Corporate forms
 * that are conventionally written in capitals (SA, NV, AG, PLC) are
 * deliberately absent, because leaving them alone is already correct.
 */
const SHORT_WORDS = new Set([
  "THE", "AND", "FOR", "OF", "CO", "COM", "INC", "LTD",
  "NEW", "OLD", "ONE", "ALL", "OUR", "OIL", "GAS", "AIR", "SEA", "SUN",
]);

/**
 * Title-cases a name that arrived entirely in capitals, leaving mixed-case
 * names untouched.
 *
 * Deliberately conservative: it fires only when there is no lowercase letter
 * anywhere, so a name the SEC already cased properly is never "corrected" —
 * "lululemon athletica inc." keeps its lowercase l, and Apple Inc. is left
 * exactly as filed.
 *
 * Within a shouted name, short tokens stay in capitals unless they are in
 * SHORT_WORDS above. An earlier version tested for a vowel instead, on the
 * theory that acronyms lack them; AMC disproves that, and the rule now turns
 * on length and a list rather than on a guess about spelling.
 */
export function deShout(name: string): string {
  if (/[a-z]/.test(name)) return name;

  return name
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;

      // Punctuation and digits are not evidence either way — "AT&T" carries
      // three letters and "3M" carries one.
      const letters = token.replace(/[^A-Z]/g, "");
      if (letters.length <= 3 && !SHORT_WORDS.has(letters)) return token;

      return token.charAt(0) + token.slice(1).toLowerCase();
    })
    .join("");
}
