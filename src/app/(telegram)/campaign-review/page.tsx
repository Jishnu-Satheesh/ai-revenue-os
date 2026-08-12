import { TelegramReview } from "@/components/campaigns/telegram-review";
import { demoCampaignDetail } from "@/modules/campaigns/demo/fixtures";

/**
 * Preview of the Telegram Mini App review surface.
 *
 * The production version validates Telegram-signed initialization data, maps
 * the Telegram identity to a linked platform identity, and rechecks live
 * membership and role on every sensitive action. None of that exists yet, so
 * this route renders the same demo campaign the Studio does and performs no
 * approval.
 */
export default function TelegramCampaignReviewPage() {
  return <TelegramReview campaign={demoCampaignDetail} organizationName="Al Noor Kitchen" />;
}
