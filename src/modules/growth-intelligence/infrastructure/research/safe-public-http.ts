import { isIP } from "node:net";

import { parse } from "tldts";

export type ResolvedAddress = { address: string; family: 4 | 6 };

export type PublicAddressResolver = {
  resolve(hostname: string): Promise<ResolvedAddress[]>;
};

export type PinnedPeerTransport = {
  request(input: {
    url: URL;
    resolvedAddresses: ResolvedAddress[];
    timeoutMs: number;
    maxResponseBytes: number;
    abortSignal: AbortSignal;
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: AsyncIterable<Uint8Array>;
    connectedAddress: string;
  }>;
};

export type PublicHttpErrorCode =
  | "UNSAFE_URL"
  | "UNSAFE_HOST"
  | "UNSAFE_PORT"
  | "UNSAFE_ADDRESS"
  | "DNS_UNAVAILABLE"
  | "PEER_MISMATCH"
  | "REDIRECT_INVALID"
  | "REDIRECT_LIMIT"
  | "BODY_TOO_LARGE"
  | "REQUEST_TIMEOUT"
  | "REQUEST_FAILED";

export class PublicHttpError extends Error {
  readonly name = "PublicHttpError";

  constructor(public readonly code: PublicHttpErrorCode) {
    super("Public research retrieval was unavailable.");
  }
}

function isUnsafeIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return true;
  }
  const [a, b, c] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function expandIpv6(address: string): string[] | null {
  const lower = address.toLowerCase();
  if (lower.includes(".")) {
    const separator = lower.lastIndexOf(":");
    if (separator < 0) return null;
    const ipv4 = lower.slice(separator + 1);
    if (isIP(ipv4) !== 4) return null;
    const [a, b, c, d] = ipv4.split(".").map(Number);
    const prefix = lower.slice(0, separator);
    return expandIpv6(
      `${prefix}:${((a! << 8) | b!).toString(16)}:${((c! << 8) | d!).toString(16)}`,
    );
  }
  const parts = lower.split("::");
  if (parts.length > 2) return null;
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (parts.length === 1) return left.length === 8 ? left : null;
  const omitted = 8 - left.length - right.length;
  return omitted >= 1 ? [...left, ...Array(omitted).fill("0"), ...right] : null;
}

function isUnsafeIpv6(address: string): boolean {
  const parts = expandIpv6(address);
  if (!parts) return true;
  const groups = parts.map((part) => Number.parseInt(part, 16));
  const [first, second, third, fourth, fifth, sixth, seventh, eighth] = groups;
  const isEmbeddedIpv4 =
    first === 0 &&
    second === 0 &&
    third === 0 &&
    fourth === 0 &&
    fifth === 0 &&
    (sixth === 0 || sixth === 0xffff);
  const mappedIpv4 = `${seventh! >> 8}.${seventh! & 0xff}.${eighth! >> 8}.${eighth! & 0xff}`;
  return (
    groups.every((group) => group === 0) ||
    (groups.slice(0, 7).every((group) => group === 0) && eighth === 1) ||
    (first! & 0xfe00) === 0xfc00 ||
    (first! & 0xffc0) === 0xfe80 ||
    (first! & 0xff00) === 0xff00 ||
    (first === 0x2001 && second === 0x0db8) ||
    (isEmbeddedIpv4 && isUnsafeIpv4(mappedIpv4))
  );
}

function isUnsafeAddress(record: ResolvedAddress): boolean {
  return record.family === 4 ? isUnsafeIpv4(record.address) : isUnsafeIpv6(record.address);
}

function checkedUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicHttpError("UNSAFE_URL");
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new PublicHttpError("UNSAFE_URL");
  }
  if (
    url.port &&
    !(
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    )
  ) {
    throw new PublicHttpError("UNSAFE_PORT");
  }
  const host = parse(url.hostname, { allowPrivateDomains: false, detectIp: true });
  if (host.isIp || host.domain === null) throw new PublicHttpError("UNSAFE_HOST");
  return url;
}

async function resolvePublic(
  url: URL,
  resolver: PublicAddressResolver,
): Promise<ResolvedAddress[]> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver.resolve(url.hostname);
  } catch {
    throw new PublicHttpError("DNS_UNAVAILABLE");
  }
  if (addresses.length === 0) throw new PublicHttpError("DNS_UNAVAILABLE");
  if (addresses.some((address) => isUnsafeAddress(address)))
    throw new PublicHttpError("UNSAFE_ADDRESS");
  return addresses;
}

function beforeDeadline<T>(promise: Promise<T>, abortSignal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new PublicHttpError("REQUEST_TIMEOUT"));
    if (abortSignal.aborted) {
      onAbort();
      return;
    }
    abortSignal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        abortSignal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        abortSignal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function readBoundedBody(input: {
  body: AsyncIterable<Uint8Array>;
  maxResponseBytes: number;
  abortSignal: AbortSignal;
}): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const iterator = input.body[Symbol.asyncIterator]();
  for (;;) {
    const next = await beforeDeadline(iterator.next(), input.abortSignal);
    if (next.done) break;
    if (!(next.value instanceof Uint8Array)) throw new PublicHttpError("REQUEST_FAILED");
    byteLength += next.value.byteLength;
    if (byteLength > input.maxResponseBytes) throw new PublicHttpError("BODY_TOO_LARGE");
    chunks.push(next.value);
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchPublicHttp(input: {
  url: string;
  resolver: PublicAddressResolver;
  transport: PinnedPeerTransport;
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
}): Promise<{ url: string; status: number; headers: Record<string, string>; body: Uint8Array }> {
  const timeoutMs = input.timeoutMs ?? 10_000;
  const maxResponseBytes = input.maxResponseBytes ?? 256 * 1_024;
  const maxRedirects = input.maxRedirects ?? 2;
  let current = checkedUrl(input.url);

  for (let redirects = 0; ; redirects += 1) {
    const resolvedAddresses = await resolvePublic(current, input.resolver);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await beforeDeadline(
        input.transport.request({
          url: current,
          resolvedAddresses,
          timeoutMs,
          maxResponseBytes,
          abortSignal: controller.signal,
        }),
        controller.signal,
      );
      if (!resolvedAddresses.some((address) => address.address === response.connectedAddress)) {
        throw new PublicHttpError("PEER_MISMATCH");
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= maxRedirects) throw new PublicHttpError("REDIRECT_LIMIT");
        const location = Object.entries(response.headers).find(
          ([name]) => name.toLowerCase() === "location",
        )?.[1];
        if (!location) throw new PublicHttpError("REDIRECT_INVALID");
        current = checkedUrl(new URL(location, current).toString());
        continue;
      }
      const body = await readBoundedBody({
        body: response.body,
        maxResponseBytes,
        abortSignal: controller.signal,
      });
      return { url: current.toString(), status: response.status, headers: response.headers, body };
    } catch (error) {
      if (error instanceof PublicHttpError) throw error;
      throw new PublicHttpError("REQUEST_FAILED");
    } finally {
      clearTimeout(timer);
    }
  }
}
