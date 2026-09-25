import { canonicalJson } from "@/domain/campaigns/canonical-json";

/**
 * Studio content digests without a Node built-in.
 *
 * The Studio contracts ship to the browser (schema-only until Task 7), and a
 * `node:crypto` import anywhere in that chain fails the client build outright
 * — the anti-pattern `context/18-anti-patterns.md` names. So SHA-256 lives
 * here as dependency-free TypeScript, and the test suite checks every digest
 * against `node:crypto` as an independent oracle.
 */

const ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

/** SHA-256 over bytes, returned as lowercase hex. */
export function sha256HexBytes(input: Uint8Array): string {
  const paddedLength = (((input.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;

  const view = new DataView(padded.buffer, padded.byteOffset, padded.byteLength);
  view.setUint32(paddedLength - 8, Math.floor(input.length / 0x20000000));
  view.setUint32(paddedLength - 4, (input.length << 3) >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) schedule[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 =
        rotateRight(schedule[i - 15]!, 7) ^
        rotateRight(schedule[i - 15]!, 18) ^
        (schedule[i - 15]! >>> 3);
      const s1 =
        rotateRight(schedule[i - 2]!, 17) ^
        rotateRight(schedule[i - 2]!, 19) ^
        (schedule[i - 2]! >>> 10);
      schedule[i] = (schedule[i - 16]! + s0 + schedule[i - 7]! + s1) | 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + ROUND_CONSTANTS[i]! + schedule[i]!) | 0;
      const s0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((word) => (word >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** SHA-256 over a Unicode string's UTF-8 bytes, as lowercase hex. */
export function sha256HexText(input: string): string {
  return sha256HexBytes(new TextEncoder().encode(input));
}

/** SHA-256 over canonical JSON, so key order never affects an identity. */
export function sha256HexCanonical(value: unknown): string {
  return sha256HexText(canonicalJson(value, "$"));
}

/**
 * The exact prompt bytes a suggestion was made from. Stored beside the
 * suggestion so applying it after further edits is refused as stale rather
 * than pasted over new work.
 */
export function studioPromptDigest(prompt: string): string {
  return sha256HexText(prompt);
}

/**
 * The exact Text Copy bytes a version was rendered from. Whitespace,
 * newlines and code points all count: a digest that ignored them would call
 * two different posters the same one.
 */
export function studioTextCopyDigest(textCopy: string): string {
  return sha256HexText(textCopy);
}

/** The reference manifest, sorted by reference id so selection order is not identity. */
export function studioReferenceManifestDigest(
  references: readonly { referenceId: string; kind: string; contentHash: string }[],
): string {
  const manifest = [...references]
    .sort((left, right) => (left.referenceId < right.referenceId ? -1 : 1))
    .map((reference) => ({
      contentHash: reference.contentHash,
      kind: reference.kind,
      referenceId: reference.referenceId,
    }));
  return sha256HexCanonical(manifest);
}

/** The channel-logo substitution manifest: a moved range is a new manifest. */
export function studioLogoSubstitutionDigest(
  substitutions: readonly {
    start: number;
    end: number;
    phrase: string;
    channelId: string;
    logoAssetVersionId: string;
    logoContentHash: string;
  }[],
): string {
  return sha256HexCanonical(substitutions);
}

/**
 * The idempotency digest over the admitted run inputs: operation, exact copy,
 * substitution manifest, primary reference, prompt, reference hashes, parent,
 * profile, preset and campaign. Replaying a key with different bytes is a
 * conflict, never a silent rerun.
 */
export function studioIdempotencyDigest(inputs: Record<string, unknown>): string {
  return sha256HexCanonical(inputs);
}

/**
 * The export identity: same source version, bytes, transform and preset
 * reuses the same export; any byte, encoding or transform change mints
 * another. The provider version and context never enter it, because an
 * export changes pixels, never provenance.
 */
export function studioExportDigest(input: {
  readonly studioVersionId: string;
  readonly sourceContentHash: string;
  readonly transform: unknown;
  readonly transformVersion: number;
  readonly presetVersion: number;
  readonly aspectPreset: string;
}): string {
  return sha256HexCanonical({
    aspectPreset: input.aspectPreset,
    presetVersion: input.presetVersion,
    sourceContentHash: input.sourceContentHash,
    studioVersionId: input.studioVersionId,
    transform: input.transform,
    transformVersion: input.transformVersion,
  });
}
