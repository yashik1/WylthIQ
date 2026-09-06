/**
 * SEC EDGAR requires a User-Agent identifying the requester with a contact
 * address; requests without one are rejected. It is also rate limited to 10
 * requests/second, and exceeding that earns a ~10 minute IP block.
 *
 * Override via SEC_USER_AGENT in the environment when deploying.
 */
export const SEC_USER_AGENT =
  process.env.SEC_USER_AGENT ?? "WylthIQ (open source stock research) contact@wylthiq.app";

/** Conservative spacing between EDGAR requests, in milliseconds. */
export const SEC_REQUEST_INTERVAL_MS = 150;
