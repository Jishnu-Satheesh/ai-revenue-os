import { describe, expect, it } from "vitest";

import {
  parseVerifiedProviderContract,
  telegramOperatorReviewProviderContract,
} from "@/modules/integrations/providers/telegram-operator-review/contract";

describe("Telegram operator-review provider contract", () => {
  it("is valid but exposes no executable action without controlled bot evidence", () => {
    const parsed = parseVerifiedProviderContract(
      telegramOperatorReviewProviderContract,
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(parsed.providerKey).toBe("telegram_operator_review");
    expect(parsed.apiVersion).toBe("Bot API 10.2");
    expect(parsed.exactScopes).toEqual([]);
    expect(parsed.actions).toEqual([]);
    expect(parsed.knownRestrictions.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "telegram.controlled_bot_configuration_unverified",
        "telegram.operator_review_only",
        "telegram.customer_messaging_prohibited",
      ]),
    );
  });

  it("keeps Telegram unavailable as a campaign audience or publishing destination", () => {
    const parsed = parseVerifiedProviderContract(
      telegramOperatorReviewProviderContract,
      new Date("2026-08-11T12:00:00.000Z"),
    );

    expect(parsed.placements).toEqual([]);
    expect(parsed.knownRestrictions).toContainEqual(
      expect.objectContaining({
        code: "telegram.operator_review_only",
        actionKey: "telegram.customer_campaign_channel",
      }),
    );
  });
});
