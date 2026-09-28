/**
 * Who may connect with a Flex token.
 *
 * Pasting a Flex token hands this server a credential for the reader's IBKR
 * reports. The site owner is happy to do that for their own account; nobody
 * else should have to, since SnapTrade and statement uploads give everyone
 * else the same result without this app ever holding a key for their broker.
 * So the token route is open only to the addresses listed here.
 */
export function flexTokenAllowed(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.BROKER_FLEX_TOKEN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}
