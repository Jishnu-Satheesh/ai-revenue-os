const CHANNEL_KEY_PATTERN = /^[a-z][a-z0-9.-]{1,80}$/;

/**
 * Produces the exact comparison value used for source aliases. It deliberately
 * does not remove punctuation, transliterate, or perform fuzzy matching: those
 * operations could merge two distinct organization-owned channels.
 */
export function normalizeChannelAlias(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
}

/** A stored channel key is immutable machine identity, not a display label. */
export function normalizeChannelKey(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");

  if (!CHANNEL_KEY_PATTERN.test(normalized)) {
    throw new Error("CHANNEL_KEY_INVALID");
  }

  return normalized;
}
