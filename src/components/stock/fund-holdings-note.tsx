import type { FundManager } from "@/lib/etf/fund-manager";

/**
 * Where a fund's holdings on this page come from, or why there are none.
 *
 * A filed portfolio and a manager's own list are both said to be below. A
 * fund with neither names its manager and links there, rather than leaving a
 * reader to wonder whether the holdings failed to load: the honest answer for
 * most Canadian managers is that they publish them only on their own site.
 */
export function FundHoldingsNote({
  filed,
  publishedBy,
  manager,
}: {
  /** Whether the fund's own N-PORT filing is on the page. */
  filed: boolean;
  /** The manager whose holdings list is on the page, if one is. */
  publishedBy: string | null;
  manager: FundManager | null;
}) {
  if (filed) return <>What it owns is a matter of public record, and it is below.</>;
  if (publishedBy) return <>What it owns, as {publishedBy} publishes it, is below.</>;
  if (manager) {
    return (
      <>
        {manager.name} doesn&rsquo;t publish this fund&rsquo;s holdings in a form this site can read, so
        they aren&rsquo;t listed here. They&rsquo;re on{" "}
        <a href={manager.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">
          {manager.name}&rsquo;s website
        </a>
        .
      </>
    );
  }
  return <>Price history below still applies.</>;
}
