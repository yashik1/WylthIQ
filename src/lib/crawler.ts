/**
 * Whether a request comes from a crawler rather than a person.
 *
 * A stock page streams: the reader gets a skeleton at once and the company
 * arrives a moment later, which React writes into a hidden block and swaps in
 * with a script. Google runs that script. Most other crawlers do not — the AI
 * answer engines among them — and they read the hidden block as no content at
 * all, so a site audit counted three words on every company page.
 *
 * A crawler is given the finished page in one piece instead. It waits a little
 * longer for the first byte, which costs a crawler nothing and a person a
 * great deal, which is why people keep the streamed page.
 *
 * Next's own `userAgent().isBot` knows the search and social crawlers but none
 * of the AI ones, so this list is broader: anything calling itself a bot,
 * crawler or spider, plus the AI agents that do not.
 */
const CRAWLER =
  /bot(?:\b|[/_-])|crawler|crawling|spider|slurp|facebookexternalhit|facebookcatalog|embedly|quora link preview|whatsapp|skypeuripreview|ia_archiver|google-extended|google-inspectiontool|chatgpt-user|anthropic-ai|claude-web|claude-user|perplexity-user|cohere-ai|meta-externalagent|diffbot/i;

export function isCrawler(userAgent: string | null | undefined): boolean {
  return typeof userAgent === "string" && CRAWLER.test(userAgent);
}
