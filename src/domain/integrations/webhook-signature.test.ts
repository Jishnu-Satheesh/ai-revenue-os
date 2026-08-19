import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  evaluateWebhookHandshake,
  verifyWebhookSignature,
} from "@/domain/integrations/webhook-signature";

const SECRET = "app-secret";
const BODY = '{"object":"instagram","entry":[]}';

function sign(body: string, secret = SECRET) {
  return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

describe("a webhook is verified before anything reads it", () => {
  it("accepts a signature over exactly the bytes the provider signed", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, headerValue: sign(BODY), secret: SECRET }),
    ).toEqual({ verified: true });
  });

  it("refuses a body that changed by one character", () => {
    const tampered = BODY.replace("instagram", "instagrbm");

    expect(
      verifyWebhookSignature({ rawBody: tampered, headerValue: sign(BODY), secret: SECRET }),
    ).toEqual({ verified: false, reason: "mismatch" });
  });

  it("refuses a signature made with a different secret", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, headerValue: sign(BODY, "other"), secret: SECRET }),
    ).toEqual({ verified: false, reason: "mismatch" });
  });

  it("names a missing header separately from a wrong one", () => {
    expect(verifyWebhookSignature({ rawBody: BODY, headerValue: null, secret: SECRET })).toEqual({
      verified: false,
      reason: "missing",
    });
  });

  it("refuses a header without the algorithm prefix", () => {
    const bare = sign(BODY).replace("sha256=", "");

    expect(verifyWebhookSignature({ rawBody: BODY, headerValue: bare, secret: SECRET })).toEqual({
      verified: false,
      reason: "malformed",
    });
  });

  it("refuses a signature that is not hex rather than comparing garbage", () => {
    expect(
      verifyWebhookSignature({ rawBody: BODY, headerValue: "sha256=zzzz", secret: SECRET }),
    ).toEqual({ verified: false, reason: "malformed" });
  });

  it("refuses a truncated signature instead of throwing", () => {
    // timingSafeEqual throws on unequal lengths, and a thrown error is itself
    // an observable difference between a near-miss and a wild guess.
    const short = sign(BODY).slice(0, 20);

    expect(verifyWebhookSignature({ rawBody: BODY, headerValue: short, secret: SECRET })).toEqual({
      verified: false,
      reason: "mismatch",
    });
  });

  it("is case-insensitive about the hex, as providers vary", () => {
    const upper = sign(BODY).toUpperCase().replace("SHA256=", "sha256=");

    expect(verifyWebhookSignature({ rawBody: BODY, headerValue: upper, secret: SECRET })).toEqual({
      verified: true,
    });
  });
});

describe("the subscription handshake proves who is asking", () => {
  it("echoes the challenge when the token matches", () => {
    expect(
      evaluateWebhookHandshake({
        mode: "subscribe",
        challenge: "1158201444",
        verifyToken: "configured",
        expectedToken: "configured",
      }),
    ).toEqual({ outcome: "echo", challenge: "1158201444" });
  });

  it("refuses a wrong token rather than confirming the endpoint", () => {
    // Echoing without checking would let anyone who guesses the URL verify the
    // subscription on our behalf.
    expect(
      evaluateWebhookHandshake({
        mode: "subscribe",
        challenge: "1",
        verifyToken: "guessed",
        expectedToken: "configured",
      }),
    ).toEqual({ outcome: "refused", reason: "bad_token" });
  });

  it("refuses a token of a different length without throwing", () => {
    expect(
      evaluateWebhookHandshake({
        mode: "subscribe",
        challenge: "1",
        verifyToken: "short",
        expectedToken: "a-much-longer-token",
      }),
    ).toEqual({ outcome: "refused", reason: "bad_token" });
  });

  it("refuses any mode other than subscribe", () => {
    expect(
      evaluateWebhookHandshake({
        mode: "unsubscribe",
        challenge: "1",
        verifyToken: "configured",
        expectedToken: "configured",
      }),
    ).toEqual({ outcome: "refused", reason: "wrong_mode" });
  });

  it("refuses a handshake with nothing to echo", () => {
    expect(
      evaluateWebhookHandshake({
        mode: "subscribe",
        challenge: null,
        verifyToken: "configured",
        expectedToken: "configured",
      }),
    ).toEqual({ outcome: "refused", reason: "missing_challenge" });
  });
});
