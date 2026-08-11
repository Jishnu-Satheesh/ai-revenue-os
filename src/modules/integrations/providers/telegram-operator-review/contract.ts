import {
  parseVerifiedProviderContract,
  verifiedProviderContractSchema,
  type VerifiedProviderContract,
  type VerifiedProviderContractInput,
} from "@/modules/integrations/providers/meta/contract";

export {
  parseVerifiedProviderContract,
  verifiedProviderContractSchema,
  type VerifiedProviderContract,
};

const TELEGRAM_BOT_API_SOURCE = "https://core.telegram.org/bots/api";
const TELEGRAM_MINI_APPS_SOURCE = "https://core.telegram.org/bots/webapps";

const telegramOperatorReviewProviderContract = {
  schemaVersion: 1,
  providerKey: "telegram_operator_review",
  contractVersion: "telegram_operator_review_v1",
  apiVersion: "Bot API 10.2",
  verifiedAt: "2026-08-11T00:00:00.000Z",
  expiresAt: "2026-09-10T00:00:00.000Z",
  officialSourceUrls: [TELEGRAM_BOT_API_SOURCE, TELEGRAM_MINI_APPS_SOURCE],
  evidence: [
    {
      id: "telegram.official.bot_api",
      kind: "official_source",
      sourceUrl: TELEGRAM_BOT_API_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official Bot API documents bot authorization, updates, and webhooks.",
    },
    {
      id: "telegram.official.mini_apps",
      kind: "official_source",
      sourceUrl: TELEGRAM_MINI_APPS_SOURCE,
      checkedAt: "2026-08-10T00:00:00.000Z",
      detail: "The official Mini Apps guide documents launch and initData validation.",
    },
  ],
  accountPrerequisites: [
    {
      key: "telegram.controlled_bot",
      detail: "The controlled bot, server-held token, webhook, and Mini App must pass.",
      verificationStatus: "blocked",
      evidenceIds: ["telegram.official.bot_api", "telegram.official.mini_apps"],
    },
    {
      key: "telegram.linked_operator",
      detail: "A linked operator and live platform authorization checks must pass.",
      verificationStatus: "blocked",
      evidenceIds: ["telegram.official.mini_apps"],
    },
  ],
  exactScopes: [],
  placements: [],
  actions: [],
  webhook: null,
  retryableStatuses: [],
  knownRestrictions: [
    {
      code: "telegram.controlled_bot_configuration_unverified",
      actionKey: "telegram.operator_review",
      detail:
        "No controlled bot, webhook, Mini App, or linked-operator evidence is checked in; the operator-review capability is blocked.",
      sourceUrl: TELEGRAM_BOT_API_SOURCE,
    },
    {
      code: "telegram.webhook_contract_unverified",
      actionKey: "telegram.webhook_intake",
      detail:
        "Telegram documents update IDs and a webhook secret header, but no controlled webhook or allowlisted update contract is verified here.",
      sourceUrl: TELEGRAM_BOT_API_SOURCE,
    },
    {
      code: "telegram.mini_app_identity_requires_server_validation",
      actionKey: "telegram.mini_app_review",
      detail:
        "Raw initData must be validated server-side, freshness checked, linked to a platform identity, and followed by a live platform authorization check.",
      sourceUrl: TELEGRAM_MINI_APPS_SOURCE,
    },
    {
      code: "telegram.operator_review_only",
      actionKey: "telegram.customer_campaign_channel",
      detail:
        "Telegram is only an authenticated operator-control surface and is never a campaign audience or publishing destination in this release train.",
      sourceUrl: TELEGRAM_MINI_APPS_SOURCE,
    },
    {
      code: "telegram.customer_messaging_prohibited",
      actionKey: "telegram.customer_messaging",
      detail:
        "Customer recipients, outbound marketing, direct messages, comments, and community management are outside this provider contract.",
      sourceUrl: TELEGRAM_BOT_API_SOURCE,
    },
    {
      code: "telegram.attachment_menu_restricted",
      actionKey: "telegram.attachment_menu_launch",
      detail:
        "Attachment-menu integration is restricted by Telegram and is not part of the operator-review launch contract.",
      sourceUrl: TELEGRAM_MINI_APPS_SOURCE,
    },
  ],
} satisfies VerifiedProviderContractInput;

export function getTelegramOperatorReviewProviderContract(
  now: Date = new Date(),
): VerifiedProviderContract {
  return parseVerifiedProviderContract(telegramOperatorReviewProviderContract, now);
}
