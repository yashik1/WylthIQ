import { unescapeXml } from "../signals/xml-extract";

/**
 * Reads the attribute-shaped XML that IBKR's Flex reports are written in.
 *
 * A Flex statement carries its data in attributes on self-closing elements —
 * `<Trade symbol="AAPL" quantity="10" … />` — which the SEC extractor in
 * xml-extract.ts does not read: that one is built for element text. Same
 * stance as that module, though: not a general XML parser, just enough for a
 * machine-generated document of known shape, and anything unreadable comes
 * back empty rather than guessed at.
 */

export type Attributes = Record<string, string>;

const ATTRIBUTE = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*)"/g;

function readAttributes(source: string): Attributes {
  const attributes: Attributes = {};
  for (const match of source.matchAll(ATTRIBUTE)) {
    attributes[match[1]] = unescapeXml(match[2]);
  }
  return attributes;
}

/**
 * The attributes of every `<tag …>` or `<tag … />` in `xml`.
 *
 * The lookahead after the name is what keeps `<Trade` from also matching
 * `<Trades>`, the section that contains them.
 */
export function elementAttributes(xml: string, tag: string): Attributes[] {
  const re = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`, "g");
  return [...xml.matchAll(re)].map((match) => readAttributes(match[1]));
}

export interface StatementBlock {
  attributes: Attributes;
  body: string;
}

/** Each `<FlexStatement …>…</FlexStatement>`: one per account the query covers. */
export function statementBlocks(xml: string): StatementBlock[] {
  const re = /<FlexStatement(?=[\s>])([^>]*)>([\s\S]*?)<\/FlexStatement>/g;
  return [...xml.matchAll(re)].map((match) => ({
    attributes: readAttributes(match[1]),
    body: match[2],
  }));
}

/** Whether a section is present at all, empty or not: `<Trades>` and `<Trades/>` both count. */
export function hasSection(xml: string, tag: string): boolean {
  return new RegExp(`<${tag}(?=[\\s/>])`).test(xml);
}
